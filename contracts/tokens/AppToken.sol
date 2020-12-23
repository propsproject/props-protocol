// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";

contract AppToken is Initializable, OwnableUpgradeable, ERC20Upgradeable {
    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address public propsTreasury;
    // Denoted in ppm
    uint256 public propsTreasuryMintPercentage;
    // Denoted in seconds
    uint256 public inflationRateChangeDelay;
    // Denoted in tokens/second
    uint256 public inflationRate;
    uint256 public pendingInflationRate;

    // Denoted as timestamp
    uint256 private _lastMint;
    uint256 private _lastInflationRateChange;

    // solhint-disable-next-line var-name-mixedcase
    bytes32 public DOMAIN_SEPARATOR;
    // solhint-disable-next-line var-name-mixedcase
    bytes32 public PERMIT_TYPEHASH;

    mapping(address => uint256) public nonces;

    event InflationRateChanged(uint256 oldInflationRate, uint256 newInflationRate);

    /**
     * @param _name The name of the app token
     * @param _symbol The symbol of the app token
     * @param _amount Initial amount of app tokens to mint
     * @param _owner The owner of the app token
     * @param _propsTreasury The Props protocol treasury
     */
    function initialize(
        string memory _name,
        string memory _symbol,
        uint256 _amount,
        address _owner,
        address _propsTreasury
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ERC20Upgradeable.__ERC20_init(_name, _symbol);

        // Set the proper owner
        if (_owner != msg.sender) {
            super.transferOwnership(_owner);
        }

        propsTreasury = _propsTreasury;
        propsTreasuryMintPercentage = 50000;
        inflationRateChangeDelay = 7 days;
        inflationRate = 0;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name())),
                getChainId(),
                address(this)
            )
        );
        PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );

        // Initial mint
        uint256 propsTreasuryAmount = _amount.mul(propsTreasuryMintPercentage).div(1e6);
        uint256 ownerAmount = _amount.sub(propsTreasuryAmount);

        _mint(propsTreasury, propsTreasuryAmount);
        _mint(super.owner(), ownerAmount);

        _lastMint = block.timestamp;
    }

    function mint() external onlyOwner {
        if (block.timestamp.sub(_lastInflationRateChange) > inflationRateChangeDelay) {
            inflationRate = pendingInflationRate;
        }

        uint256 amount = inflationRate.mul(block.timestamp.sub(_lastMint));
        if (amount != 0) {
            uint256 propsTreasuryAmount = amount.mul(propsTreasuryMintPercentage).div(1e6);
            uint256 ownerAmount = amount.sub(propsTreasuryAmount);

            _mint(propsTreasury, propsTreasuryAmount);
            _mint(super.owner(), ownerAmount);

            _lastMint = block.timestamp;
        }
    }

    function changeInflationRate(uint256 _inflationRate) external onlyOwner {
        pendingInflationRate = _inflationRate;
        _lastInflationRateChange = block.timestamp;

        emit InflationRateChanged(inflationRate, pendingInflationRate);
    }

    function recoverTokens(
        IERC20Upgradeable _token,
        address _to,
        uint256 _amount
    ) external onlyOwner {
        require(_to != address(0), "Cannot transfer to address zero");

        uint256 balance = _token.balanceOf(address(this));
        require(_amount <= balance, "Cannot transfer more than balance");

        _token.safeTransfer(_to, _amount);
    }

    function permit(
        address _owner,
        address _spender,
        uint256 _amount,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external {
        require(_deadline >= block.timestamp, "Permit expired");

        bytes32 digest =
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    DOMAIN_SEPARATOR,
                    keccak256(
                        abi.encode(
                            PERMIT_TYPEHASH,
                            _owner,
                            _spender,
                            _amount,
                            nonces[_owner]++,
                            _deadline
                        )
                    )
                )
            );

        address recoveredAddress = ecrecover(digest, _v, _r, _s);
        require(recoveredAddress != address(0) && recoveredAddress == _owner, "Invalid signature");

        _approve(_owner, _spender, _amount);
    }

    function getTotalSupply() external view returns (uint256) {
        return super.totalSupply().add(block.timestamp.sub(_lastMint).mul(inflationRate));
    }

    // TODO Handle non-overridable `totalSupply`
    // OZ's ERC20 `totalSupply` function is not virtual so it can't be overriden
    // function totalSupply() public override view returns (uint256) {
    //     return super.totalSupply().add(block.timestamp.sub(lastMint).mul(inflationRate));
    // }

    function getChainId() internal pure returns (uint256) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        return chainId;
    }
}
