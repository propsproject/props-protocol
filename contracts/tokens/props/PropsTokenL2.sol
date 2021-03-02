// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "./IPropsTokenL2.sol";

/**
 * @title  PropsTokenL2
 * @author Props
 * @dev    The L2 version of the Props token. Props tokens residing on L1
 *         can be moved on the L2 where the Props protocol resides and be
 *         used there for interacting with the protocol.
 */
contract PropsTokenL2 is Initializable, OwnableUpgradeable, ERC20Upgradeable, IPropsTokenL2 {
    using SafeMathUpgradeable for uint256;

    /**************************************
                     FIELDS
    ***************************************/

    // Set of addresses permissioned to mint additional L2 Props
    mapping(address => bool) public isMinter;

    // solhint-disable-next-line var-name-mixedcase
    uint256 public ROOT_CHAIN_ID;
    // solhint-disable-next-line var-name-mixedcase
    bytes32 public DOMAIN_SEPARATOR_L1;
    // solhint-disable-next-line var-name-mixedcase
    bytes32 public DOMAIN_SEPARATOR_L2;
    // solhint-disable-next-line var-name-mixedcase
    bytes32 public PERMIT_TYPEHASH;

    // Nonces for permit
    mapping(address => uint256) public nonces;

    /***************************************
                   INITIALIZER
    ****************************************/

    function initialize() public initializer {
        OwnableUpgradeable.__Ownable_init();
        ERC20Upgradeable.__ERC20_init("Props", "PROPS");

        // The chain id must be correspond to the chain id of the underlying root network
        // This way, users won't have to change networks in order to be able to sign transactions
        ROOT_CHAIN_ID = 1;

        DOMAIN_SEPARATOR_L1 = keccak256(
            abi.encode(
                keccak256(
                    bytes(
                        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                    )
                ),
                keccak256(bytes(name())),
                keccak256(bytes("1")),
                ROOT_CHAIN_ID,
                address(this)
            )
        );

        DOMAIN_SEPARATOR_L2 = keccak256(
            abi.encode(
                keccak256(
                    bytes(
                        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                    )
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
    }

    /***************************************
                  ADMIN ACTIONS
    ****************************************/

    /**
     * @dev Give minting permissions to an address.
     * @param _minter The address to give minting permissions to
     */
    function addMinter(address _minter) external onlyOwner {
        isMinter[_minter] = true;
    }

    /**
     * @dev Remove minting permissions from an address.
     * @param _minter The address to remove minting permissions from
     */
    function removeMinter(address _minter) external onlyOwner {
        isMinter[_minter] = false;
    }

    /***************************************
                 MINTER ACTIONS
    ****************************************/

    /**
     * @dev Mint new tokens to an account.
     * @param _account The address to mint to
     * @param _amount The amount of tokens to mint
     */
    function mint(address _account, uint256 _amount) external override {
        require(isMinter[msg.sender], "Unauthorized");
        _mint(_account, _amount);
    }

    /**
     * @dev Burn existing tokens of an account.
     * @param _account The address to burn from
     * @param _amount The amount of tokens to burn
     */
    function burn(address _account, uint256 _amount) external override {
        require(isMinter[msg.sender], "Unauthorized");
        _burn(_account, _amount);
    }

    /***************************************
                  USER ACTIONS
    ****************************************/

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
    ) external override {
        require(_deadline >= block.timestamp, "Permit expired");

        // We allow either L1 or L2 signatures
        require(
            _verify(DOMAIN_SEPARATOR_L1, _owner, _spender, _amount, _deadline, _v, _r, _s) ||
                _verify(DOMAIN_SEPARATOR_L2, _owner, _spender, _amount, _deadline, _v, _r, _s),
            "Invalid signature"
        );
        nonces[_owner]++;

        _approve(_owner, _spender, _amount);
    }

    /***************************************
                    HELPERS
    ****************************************/

    function _toEIP712Digest(bytes32 _domainSeparator, bytes32 _messageDigest)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator, _messageDigest));
    }

    function _verify(
        bytes32 _domainSeparator,
        address _owner,
        address _spender,
        uint256 _amount,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) internal view returns (bool) {
        bytes32 digest =
            keccak256(
                abi.encode(PERMIT_TYPEHASH, _owner, _spender, _amount, nonces[_owner], _deadline)
            );

        address signer = ecrecover(_toEIP712Digest(_domainSeparator, digest), _v, _r, _s);
        return signer != address(0) && signer == _owner;
    }

    function _getChainId() internal pure returns (uint256 chainId) {
        assembly {
            chainId := chainid()
        }
    }
}
