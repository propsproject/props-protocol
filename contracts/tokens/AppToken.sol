// SPDX-License-Identifier: MIT
pragma solidity 0.6.8;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";

/**
 * @title  AppToken
 * @author Props
 * @notice ERC20 token every app in the Props protocol gets associated with.
 * @dev    Each app in the Props protocol will get an associated AppToken contract.
 *         AppTokens are ERC20 compatible and mintable according to an inflation rate.
 */
contract AppToken is Initializable, OwnableUpgradeable, ERC20Upgradeable {
    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // The Props protocol treasury address
    address public propsTreasury;

    // The percentage of each mint that goes to the Props treasury (denoted in ppm)
    uint256 public propsTreasuryMintPercentage;
    // The delay before a newly set inflation rate goes into effect
    uint256 public inflationRateChangeDelay;
    // The inflation rate of the app token
    uint256 public inflationRate;
    // The new inflation rate that will go into effect once the delay passes
    uint256 public pendingInflationRate;

    // Time most recent mint occured at
    uint256 public lastMint;
    // Time most recent inflation rate change occured at
    uint256 public lastInflationRateChange;

    // solhint-disable-next-line var-name-mixedcase
    bytes32 public DOMAIN_SEPARATOR;
    // solhint-disable-next-line var-name-mixedcase
    bytes32 public PERMIT_TYPEHASH;

    mapping(address => uint256) public nonces;

    event InflationRateChanged(uint256 oldInflationRate, uint256 newInflationRate);

    /**
     * @dev Initializer.
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

        if (_owner != msg.sender) {
            transferOwnership(_owner);
        }

        propsTreasury = _propsTreasury;
        propsTreasuryMintPercentage = 50000; // 5%
        inflationRateChangeDelay = 7 days;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes(name())),
                keccak256(bytes("1")),
                _getChainId(),
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
        _mint(owner(), ownerAmount);

        lastMint = block.timestamp;
    }

    /**
     * @dev Mint additional tokens according to the current inflation rate.
     *      The amount of tokens to get minted is determined by both the last
     *      mint time and the inflation rate ((`currentTime` - `lastMint`) * `inflationRate`).
     */
    function mint() external onlyOwner {
        // If the delay for the new inflation rate passed, update the inflation rate
        if (block.timestamp.sub(lastInflationRateChange) > inflationRateChangeDelay) {
            inflationRate = pendingInflationRate;
        }

        uint256 amount = inflationRate.mul(block.timestamp.sub(lastMint));
        if (amount != 0) {
            uint256 propsTreasuryAmount = amount.mul(propsTreasuryMintPercentage).div(1e6);
            uint256 ownerAmount = amount.sub(propsTreasuryAmount);

            _mint(propsTreasury, propsTreasuryAmount);
            _mint(owner(), ownerAmount);

            lastMint = block.timestamp;
        }
    }

    /**
     * @dev Set a new inflation rate. Once a new inflation rate is set, it
     *      takes some time before it goes into effect (the delay is determined
     *      by `inflationRateChangeDelay`).
     * @param _inflationRate The new inflation rate
     */
    function changeInflationRate(uint256 _inflationRate) external onlyOwner {
        pendingInflationRate = _inflationRate;
        lastInflationRateChange = block.timestamp;

        emit InflationRateChanged(inflationRate, pendingInflationRate);
    }

    /**
     * @dev Recover tokens accidentally sent to this contract.
     * @param _token The address of the token to be recovered
     * @param _to The address to recover the tokens for
     * @param _amount The amount to recover
     */
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

    /**
     * @dev Allows for approvals to be made via off-chain signatures.
     * @param _owner The approver of the tokens
     * @param _spender The spender of the tokens
     * @param _amount Approved amount
     * @param _deadline Approval deadline
     * @param _v Part of signature
     * @param _r Part of signature
     * @param _s Part of signature
     */
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

    function _getChainId() internal pure returns (uint256) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        return chainId;
    }
}
