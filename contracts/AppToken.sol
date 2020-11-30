pragma solidity ^0.6.8;

import '@openzeppelin/contracts-upgradeable/proxy/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol';
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";

contract AppToken is Initializable, OwnableUpgradeable, ERC20Upgradeable {
    
    using SafeMathUpgradeable for uint256;
    
    uint256 public propsMintPercent = 100000; // denoted as ppm i.e. 10%
    /**
    * @dev App Token's ERC20 Logic contract that proxies point to
    * @param _name name
    * @param _owner The address of the thing owner
    * @param _propsOwner The address of the thing owner
    * @param _symbol name  
    * @param _amount Amount of tokens to mint
    */
    
    function initialize(string memory _name, string memory _symbol, uint256 _amount, address _owner, address _propsOwner) public initializer {
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