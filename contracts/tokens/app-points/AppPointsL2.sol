// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "./AppPointsCommon.sol";

// TODO: Add full support for meta-transactions

/**
 * @title  AppPointsL2
 * @author Props
 * @dev    The L2 version of AppPoints tokens.
 */
contract AppPointsL2 is Initializable, AppPointsCommon {
    /***************************************
                     FIELDS
    ****************************************/

    // Set of addresses allowed to mint and burn (needed for bridging the tokens between L1 and L2)
    mapping(address => bool) public isMinter;

    // IPFS hash pointing to app information
    bytes public appInfo;

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
    function mint(address _account, uint256 _amount) external {
        require(isMinter[msg.sender], "Unauthorized");
        _mint(_account, _amount);
    }

    /**
     * @dev Burn existing tokens of an account.
     * @param _account The address to burn from
     * @param _amount The amount of tokens to burn
     */
    function burn(address _account, uint256 _amount) external {
        require(isMinter[msg.sender], "Unauthorized");
        _burn(_account, _amount);
    }
}
