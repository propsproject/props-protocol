// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";

contract AppToken is Initializable, OwnableUpgradeable, ERC20Upgradeable {
    using SafeMathUpgradeable for uint256;

    // Denoted as ppm i.e. 10%
    uint256 public propsMintPercent = 100000;

    /**
     * @notice App Token's ERC20 logic contract that proxies point to
     * @param _name Name of the app token
     * @param _symbol Symbol of the app token
     * @param _amount Amount of app tokens to mint
     * @param _owner The owner of the app token
     * @param _propsOwner The owner of the protocol-assigned tokens
     */
    function initialize(
        string memory _name,
        string memory _symbol,
        uint256 _amount,
        address _owner,
        address _propsOwner
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ERC20Upgradeable.__ERC20_init(_name, _symbol);
        if (_owner != msg.sender) {
            transferOwnership(_owner);
        }

        uint256 amountWithDecimals = _amount.mul(10 ** uint256(decimals()));
        uint256 propsTokens = amountWithDecimals.mul(propsMintPercent).div(1e6);

        _mint(_owner, amountWithDecimals.sub(propsTokens));
        _mint(_propsOwner, propsTokens);
    }
}
