// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "./AppPointsCommon.sol";

/**
 * @title  AppPointsL2
 * @author Props
 * @dev    The L2 version of AppPoints tokens.
 */
contract AppPointsL2 is Initializable, AppPointsCommon {
    /***************************************
                     FIELDS
    ****************************************/

    // Address allowed to mint (needed for bridging tokens from L1)
    address public minter;

    // IPFS hash pointing to app information
    bytes public appInfo;

    // solhint-disable-next-line var-name-mixedcase
    uint256 public ROOT_CHAIN_ID;
    // solhint-disable-next-line var-name-mixedcase
    bytes32 public DOMAIN_SEPARATOR_L1;
    // solhint-disable-next-line var-name-mixedcase
    bytes32 public DOMAIN_SEPARATOR_L2;

    /**************************************
                     EVENTS
    ***************************************/

    event AppInfoChanged(bytes indexed newAppInfo);

    /***************************************
                   INITIALIZER
    ****************************************/

    /**
     * @dev Initializer.
     * @param _name The name of the app points token
     * @param _symbol The symbol of the app points token
     */
    function initialize(string memory _name, string memory _symbol) public initializer {
        AppPointsCommon.__AppPointsCommon_init(_name, _symbol);

        // The root chain id must correspond to the chain id of the underlying root Ethereum network (either mainnet or testnet)
        // This way, users won't have to change networks in order to be able to sign transactions
        ROOT_CHAIN_ID = 1;

        DOMAIN_SEPARATOR_L1 = keccak256(
            abi.encode(
                // keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
                0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f,
                keccak256(bytes(name())),
                keccak256(bytes("1")),
                ROOT_CHAIN_ID,
                address(this)
            )
        );

        DOMAIN_SEPARATOR_L2 = keccak256(
            abi.encode(
                // keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
                0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f,
                keccak256(bytes(name())),
                keccak256(bytes("1")),
                _getChainId(),
                address(this)
            )
        );
    }

    /***************************************
                  OWNER ACTIONS
    ****************************************/

    /**
     * @dev Change the IPFS hash pointing to the app information.
     * @param _appInfo The new IPFS app information hash
     */
    function changeAppInfo(bytes calldata _appInfo) external onlyOwner {
        appInfo = _appInfo;
        emit AppInfoChanged(_appInfo);
    }

    /**
     * @dev Give minting permissions to an address.
     * @param _minter The address to give minting permissions to
     */
    function setMinter(address _minter) external onlyOwner {
        minter = _minter;
    }

    /***************************************
                 BRIDGE ACTIONS
    ****************************************/

    /**
     * @dev Deposit tokens from L1.
     * @param _account The address to deposit to
     * @param _data Deposit data
     */
    function deposit(address _account, bytes calldata _data) external {
        require(msg.sender == minter, "Unauthorized");
        _mint(_account, abi.decode(_data, (uint256)));
    }

    /**
     * @dev Withdraw tokens to L1.
     * @param _amount The amount of tokens to withdraw
     */
    function withdraw(uint256 _amount) external {
        _burn(msg.sender, _amount);
    }

    /**
     * @dev Same as `withdraw`, but uses a permit for allowing an
     *      external address to withdraw on behalf of the owner.
     */
    function withdrawWithPermit(
        address _owner,
        address _spender,
        uint256 _amount,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external {
        require(_spender == address(this), "Wrong permit");

        // We only use the permit as a meta-transaction feature
        permit(_owner, _spender, _amount, _deadline, _v, _r, _s);
        // So we don't want the approval to persist
        _approve(_owner, _spender, 0);

        _burn(_owner, _amount);
    }

    /***************************************
               PERMIT VERIFICATION
    ****************************************/

    function verifyPermitSignature(
        address _owner,
        address _spender,
        uint256 _amount,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) internal view override returns (bool) {
        // On L2, we allow both L1 and L2 signatures
        return
            _verify(DOMAIN_SEPARATOR_L1, _owner, _spender, _amount, _deadline, _v, _r, _s) ||
            _verify(DOMAIN_SEPARATOR_L2, _owner, _spender, _amount, _deadline, _v, _r, _s);
    }
}
