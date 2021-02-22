// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "../interfaces/IPropsToken.sol";

contract TestPropsTokenL2 is Initializable, OwnableUpgradeable, ERC20Upgradeable, IPropsToken {
    using SafeMathUpgradeable for uint256;

    address private _minter;

    address public childChainManager;
    uint256 public override maxTotalSupply;

    // solhint-disable-next-line var-name-mixedcase
    bytes32 public PERMIT_TYPEHASH;
    // solhint-disable-next-line var-name-mixedcase
    bytes32 public DOMAIN_SEPARATOR;

    mapping(address => uint256) public nonces;

    function initialize(uint256 _maxTotalSupply, address _childChainManager) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ERC20Upgradeable.__ERC20_init("Test Props", "TPROPS");

        childChainManager = _childChainManager;
        maxTotalSupply = _maxTotalSupply;

        PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
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

        // 1 million Props reserved for testing (redeemable from the faucet)
        _mint(address(this), 1000000 * 10**18);
    }

    function redeem() external {
        this.transfer(msg.sender, 1000 * 10**18);
    }

    function deposit(address _account, bytes calldata _data) external {
        require(msg.sender == childChainManager, "Unauthorized");
        _mint(_account, abi.decode(_data, (uint256)));
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function setMinter(address _newMinter) external onlyOwner {
        _minter = _newMinter;
    }

    function mint(address _account, uint256 _amount) external override {
        require(msg.sender == _minter, "Unauthorized");
        require(totalSupply().add(_amount) <= maxTotalSupply, "Amount exceeds max total supply");
        _mint(_account, _amount);
    }

    function permit(
        address _owner,
        address _spender,
        uint256 _amount,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external override {
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