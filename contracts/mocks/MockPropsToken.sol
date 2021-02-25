// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "../tokens/props/IPropsTokenL1.sol";

/**
 * @dev Mock of the Props token used in tests. It acts as a workaround
 *      for having to bridge Props tokens from L1 to L2 by providing a
 *      full-featured Props token directly on L2.
 */
contract MockPropsToken is Initializable, OwnableUpgradeable, ERC20Upgradeable, IPropsTokenL1 {
    using SafeMathUpgradeable for uint256;

    // Set of addresses allowed to additional Props
    mapping(address => bool) public isMinter;

    // solhint-disable-next-line var-name-mixedcase
    bytes32 public PERMIT_TYPEHASH;
    // solhint-disable-next-line var-name-mixedcase
    bytes32 public DOMAIN_SEPARATOR;

    // Nonces for permit
    mapping(address => uint256) public nonces;

    function initialize(uint256 _amount) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ERC20Upgradeable.__ERC20_init("Mock Props", "MPROPS");

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

        _mint(msg.sender, _amount);
    }

    function addMinter(address _minter) external onlyOwner {
        isMinter[_minter] = true;
    }

    function removeMinter(address _minter) external onlyOwner {
        isMinter[_minter] = false;
    }

    function mint(address _account, uint256 _amount) external override {
        require(isMinter[msg.sender], "Unauthorized");
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
