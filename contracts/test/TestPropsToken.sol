// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "../interfaces/IPropsToken.sol";

contract TestPropsToken is Initializable, ERC20Upgradeable, IPropsToken {
    address private _minter;
    uint256 private _maxTotalSupply;

    // solhint-disable-next-line var-name-mixedcase
    bytes32 public PERMIT_TYPEHASH;
    // solhint-disable-next-line var-name-mixedcase
    bytes32 public DOMAIN_SEPARATOR;

    mapping(address => uint256) public nonces;

    function initialize(uint256 _amount, address minter) public initializer {
        ERC20Upgradeable.__ERC20_init("Props", "Props");

        _minter = minter;
        _maxTotalSupply = 1e9 * (10**uint256(decimals()));

        PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name())),
                getChainId(),
                address(this)
            )
        );

        _mint(msg.sender, _amount);
    }

    function maxTotalSupply() external view override returns (uint256) {
        return _maxTotalSupply;
    }

    function mint(address _account, uint256 _amount) external override {
        require(msg.sender == _minter, "Only the minter can mint new tokens");
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

    function getChainId() internal pure returns (uint256) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        return chainId;
    }
}
