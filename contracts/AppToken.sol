// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";

contract AppToken is Initializable, OwnableUpgradeable, ERC20Upgradeable {
    using SafeMathUpgradeable for uint256;

    address public propsTreasury;
    // Denoted in ppm
    uint256 public propsTreasuryMintPercentage;
    // Denoted in seconds
    uint256 public inflationRateChangeDelay;
    // Denoted in tokens/second
    uint256 public inflationRate;
    uint256 public pendingInflationRate;

    // Denoted as timestamp
    uint256 private _lastMint;
    uint256 private _lastInflationRateChange;

    /**
     * @param _name The name of the app token
     * @param _symbol The symbol of the app token
     * @param _amount Initial amount of app tokens to mint
     * @param _owner The owner of the app token
     * @param _propsTreasury The Props protocol treasury
     */
    function initialize(
        string memory _name,
        string memory _symbol,
        uint256 _amount,
        address _owner,
        address _propsTreasury
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ERC20Upgradeable.__ERC20_init(_name, _symbol);

        if (_owner != msg.sender) {
            super.transferOwnership(_owner);
        }

        propsTreasury = _propsTreasury;
        propsTreasuryMintPercentage = 50000;
        inflationRateChangeDelay = 7 days;

        // Initial mint
        uint256 propsTreasuryAmount = _amount.mul(propsTreasuryMintPercentage).div(1e6);
        uint256 ownerAmount = _amount.sub(propsTreasuryAmount);

        _mint(propsTreasury, propsTreasuryAmount);
        _mint(super.owner(), ownerAmount);

        _lastMint = block.timestamp;
    }

    function mint() public onlyOwner {
        if (block.timestamp.sub(_lastInflationRateChange) > inflationRateChangeDelay) {
            inflationRate = pendingInflationRate;
        }

        uint256 amount = inflationRate.mul(block.timestamp.sub(_lastMint));
        if (amount != 0) {
            uint256 propsTreasuryAmount = amount.mul(propsTreasuryMintPercentage).div(1e6);
            uint256 ownerAmount = amount.sub(propsTreasuryAmount);

            _mint(propsTreasury, propsTreasuryAmount);
            _mint(super.owner(), ownerAmount);

            _lastMint = block.timestamp;
        }
    }

    function changeInflationRate(uint256 _inflationRate) public onlyOwner {
        pendingInflationRate = _inflationRate;
        _lastInflationRateChange = block.timestamp;
    }

    function getTotalSupply() public view returns (uint256) {
        return super.totalSupply().add(block.timestamp.sub(_lastMint).mul(inflationRate));
    }

    // TODO Implement `permit`

    // TODO Implement `recover`

    // TODO Add events

    // TODO Handle non-overridable `totalSupply`
    // OZ's ERC20 `totalSupply` function is not virtual so it can't be overriden
    // function totalSupply() public override view returns (uint256) {
    //     return super.totalSupply().add(block.timestamp.sub(lastMint).mul(inflationRate));
    // }
}
