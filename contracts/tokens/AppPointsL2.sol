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

    // The address of the L2 token bridge permissioned to mint
    address public bridge;

    /***************************************
                   INITIALIZER
    ****************************************/

    /**
     * @dev Initializer.
     * @param _name The name of the app points token
     * @param _symbol The symbol of the app points token
     * @param _bridge The address of the L2 token bridge
     */
    function initialize(
        string memory _name,
        string memory _symbol,
        address _bridge
    ) public initializer {
        AppPointsCommon.__AppPointsCommon_init(_name, _symbol);

        bridge = _bridge;
    }

    /***************************************
                  BRIDGE ACTIONS
    ****************************************/

    /**
     * @dev Mint new tokens to an account.
     * @param _account The address to mint to
     * @param _amount The amount of tokens to mint
     */
    function mint(address _account, uint256 _amount) external {
        require(msg.sender == bridge, "Unauthorized");
        _mint(_account, _amount);
    }

    /**
     * @dev Burn existing tokens of an account.
     * @param _account The address to burn from
     * @param _amount The amount of tokens to burn
     */
    function burn(address _account, uint256 _amount) external {
        require(msg.sender == bridge, "Unauthorized");
        _burn(_account, _amount);
    }
}
