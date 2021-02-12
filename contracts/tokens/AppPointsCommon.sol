// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

import "../interfaces/IAppPoints.sol";

/**
 * @title  AppPointsCommon
 * @author Props
 * @dev    Includes common functionality that is shared by both the L1 and L2
 *         variants of the AppPoints tokens. The most important common
 *         characteristic is that AppPoints tokens are pausable (and thus transfers
 *         can be restricted) but this restriction can be overcame via whitelisting,
 *         which only the owner is allowed to perform.
 */
abstract contract AppPointsCommon is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ERC20Upgradeable,
    IAppPoints
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**************************************
                     FIELDS
    ***************************************/

    // Whitelist of addresses allowed to transfer when paused
    mapping(address => bool) public transfersWhitelist;

    // solhint-disable-next-line var-name-mixedcase
    bytes32 public DOMAIN_SEPARATOR;
    // solhint-disable-next-line var-name-mixedcase
    bytes32 public PERMIT_TYPEHASH;

    mapping(address => uint256) public nonces;

    /**************************************
                     EVENTS
    ***************************************/

    event AddressWhitelisted(address indexed account);
    event AddressBlacklisted(address indexed account);

    /***************************************
                   INITIALIZER
    ****************************************/

    /**
     * @dev Initializer.
     * @param _name The name of the app points token
     * @param _symbol The symbol of the app points token
     */
    // solhint-disable-next-line func-name-mixedcase
    function __AppPointsCommon_init(string memory _name, string memory _symbol) public initializer {
        OwnableUpgradeable.__Ownable_init();
        PausableUpgradeable.__Pausable_init();
        ERC20Upgradeable.__ERC20_init(_name, _symbol);

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
    }

    /***************************************
                  OWNER ACTIONS
    ****************************************/

    /**
     * @dev Pause AppPoints token transfers.
     */
    function pause() public override onlyOwner {
        _pause();
    }

    /**
     * @dev Unpause AppPoints token transfers.
     */
    function unpause() public override onlyOwner {
        _unpause();
    }

    /**
     * @dev Whitelist an address for transfers when paused.
     * @param _account The address of the account to whitelist
     */
    function whitelistForTransfers(address _account) external override onlyOwner {
        transfersWhitelist[_account] = true;
        emit AddressWhitelisted(_account);
    }

    /**
     * @dev Blacklist an address for transfers when paused.
     * @param _account The address of the account to blacklist
     */
    function blacklistForTransfers(address _account) external override onlyOwner {
        transfersWhitelist[_account] = false;
        emit AddressBlacklisted(_account);
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

    /***************************************
                     HELPERS
    ****************************************/

    function _getChainId() internal pure returns (uint256) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        return chainId;
    }

    /***************************************
                      HOOKS
    ****************************************/

    function _beforeTokenTransfer(
        address _from,
        address,
        uint256
    ) internal view override {
        require(!paused() || _from == address(0) || transfersWhitelist[_from], "Unauthorized");
    }
}
