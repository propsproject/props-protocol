// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "./AppPointsCommon.sol";

/**
 * @title  AppPointsL1
 * @author Props
 * @notice ERC20 token every app in the Props protocol gets associated with.
 * @dev    The L1 version of AppPoints tokens. Each app in the Props protocol will
 *         get an associated AppPoints contract. AppPoints are ERC20 compatible and
 *         mintable according to an inflation rate.
 */
contract AppPointsL1 is Initializable, AppPointsCommon {
    using SafeMathUpgradeable for uint256;

    /**************************************
                     FIELDS
    ***************************************/

    // The Props protocol treasury address
    address public propsTreasury;

    // The percentage of each mint that goes to the Props treasury (denoted in ppm)
    uint256 public propsTreasuryMintPercentage;
    // The delay before a newly set inflation rate goes into effect
    uint256 public inflationRateChangeDelay;
    // The inflation rate of the app points token
    uint256 public inflationRate;
    // The new inflation rate that will go into effect once the delay passes
    uint256 public pendingInflationRate;

    // Time most recent mint occured at
    uint256 public lastMint;
    // Time most recent inflation rate change occured at
    uint256 public lastInflationRateChange;

    // IPFS hash pointing to app information
    bytes public appInfo;

    /**************************************
                     EVENTS
    ***************************************/

    event AppInfoChanged(bytes indexed newAppInfo);
    event InflationRateChanged(uint256 oldInflationRate, uint256 newInflationRate);

    /***************************************
                   INITIALIZER
    ****************************************/

    /**
     * @dev Initializer.
     * @param _name The name of the app points token
     * @param _symbol The symbol of the app points token
     * @param _amount Initial amount of app points to mint
     * @param _owner The owner of the app points token
     * @param _propsTreasury The Props protocol treasury
     */
    function initialize(
        string memory _name,
        string memory _symbol,
        uint256 _amount,
        address _owner,
        address _propsTreasury
    ) public initializer {
        AppPointsCommon.__AppPointsCommon_init(_name, _symbol);

        propsTreasury = _propsTreasury;
        propsTreasuryMintPercentage = 50000; // 5%
        inflationRateChangeDelay = 7 days;

        // Initial mint
        uint256 propsTreasuryAmount = _amount.mul(propsTreasuryMintPercentage).div(1e6);
        uint256 appOwnerAmount = _amount.sub(propsTreasuryAmount);

        _mint(_propsTreasury, propsTreasuryAmount);
        _mint(_owner, appOwnerAmount);

        lastMint = block.timestamp;
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
     * @dev Mint additional tokens according to the current inflation rate.
     *      The amount of tokens to get minted is determined by both the last
     *      mint time and the inflation rate (given by the following formula:
     *      (`currentTime` - `lastMint`) * `inflationRate`).
     */
    function mint() external onlyOwner {
        // If the delay for the new inflation rate passed, update the inflation rate
        if (block.timestamp.sub(lastInflationRateChange) > inflationRateChangeDelay) {
            inflationRate = pendingInflationRate;
        }

        uint256 amount = inflationRate.mul(block.timestamp.sub(lastMint));
        if (amount != 0) {
            uint256 propsTreasuryAmount = amount.mul(propsTreasuryMintPercentage).div(1e6);
            uint256 ownerAmount = amount.sub(propsTreasuryAmount);

            _mint(propsTreasury, propsTreasuryAmount);
            _mint(owner(), ownerAmount);

            lastMint = block.timestamp;
        }
    }

    /**
     * @dev Set a new inflation rate. Once a new inflation rate is set, it
     *      takes some time before it goes into effect (the delay is determined
     *      by `inflationRateChangeDelay`).
     * @param _inflationRate The new inflation rate
     */
    function changeInflationRate(uint256 _inflationRate) external onlyOwner {
        pendingInflationRate = _inflationRate;
        lastInflationRateChange = block.timestamp;

        emit InflationRateChanged(inflationRate, pendingInflationRate);
    }
}
