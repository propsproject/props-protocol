pragma solidity ^0.6.2;

import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "./IPropsToken.sol";

/**
 * @title Props Rewards Library
 * @dev Library to manage application and validators and parameters
 **/
library PropsRewardsLib {
    using SafeMath for uint256;
    /*
    *  Events
    */
    event AllocationChanged(
        address indexed wallet,
        uint256 indexed rewardsDay,
        address indexed appId,
        bytes32 userId,
        uint256 amount,
        uint256 amountChanged
    );
    /*
    *  Storage
    */

    uint8 public constant  MAX_APPLICATION_USER_PER_WALLET = 10;// max allocations possible by a single wallet
        
    // The various parameters used by the contract
    enum ParameterName {
        ApplicationRewardsPercent,
        ApplicationRewardsMaxVariationPercent,
        ValidatorMajorityPercent,
        ValidatorRewardsPercent,
        StakingInterestRate,
        WithdrawCooldownPeriodDays,
        RestakeCooldownPeriodDays
    }
    enum RewardedEntityType { Application, Validator }

    // Represents a parameter current, previous and time of change
    struct Parameter {
        uint256 currentValue;                   // current value in Pphm valid after timestamp
        uint256 previousValue;                  // previous value in Pphm for use before timestamp
        uint256 rewardsDay;                     // timestamp of when the value was updated
    }
    // Represents application details
    struct RewardedEntity {
        bytes32 name;                           // Application name
        address rewardsAddress;                 // address where rewards will be minted to
        address sidechainAddress;               // address used on the sidechain
        bool isInitializedState;                // A way to check if there's something in the map and whether it is already added to the list
        RewardedEntityType entityType;          // Type of rewarded entity
    }

    // Represents validators current and previous lists
    struct RewardedEntityList {
        mapping (address => bool) current;
        mapping (address => bool) previous;
        address[] currentList;
        address[] previousList;
        uint256 rewardsDay;
    }

    // Represents daily rewards submissions and confirmations
    struct DailyRewards {
        mapping (bytes32 => Submission) submissions;
        bytes32[] submittedRewardsHashes;
        uint256 totalSupply;
        bytes32 lastConfirmedRewardsHash;
        uint256 lastApplicationsRewardsDay;
    }

    struct Submission {
        mapping (address => bool) validators;
        address[] validatorsList;
        uint256 confirmations;
        uint256 finalizedStatus;               // 0 - initialized, 1 - finalized
        bool isInitializedState;               // A way to check if there's something in the map and whether it is already added to the list
    }

    /// @dev Represents an application user
    struct ApplicationUser {
        address appId;
        bytes32 userId;
    }

    /// @dev Represents staking meta data
    struct UnstakeData {
        uint256 stakeRewardsDay;
        uint256 unstakeRewardsDay;
        uint256 amountUnstaked;
        uint256 interestRate; //in pphm
        ApplicationUser applicationUser;
    }

    /// @dev A checkpoint for marking number of votes from a given block
    struct Allocation {
        ApplicationUser applicationUser;
        uint256 amount;
        bool isInitialized;
        uint256 arrIndex;
    }


    // represent the storage structures
    struct Data {
        // applications data
        mapping (address => RewardedEntity) applications;
        address[] applicationsList;
        // validators data
        mapping (address => RewardedEntity) validators;
        address[] validatorsList;
        // adjustable parameters data
        mapping (uint256 => Parameter) parameters; // uint256 is the parameter enum index
        // the participating validators
        RewardedEntityList selectedValidators;
        // the participating applications
        RewardedEntityList selectedApplications;
        // daily rewards submission data
        DailyRewards dailyRewards;
        uint256 minSecondsBetweenDays;
        uint256 rewardsStartTimestamp;
        uint256 maxTotalSupply;
        uint256 lastValidatorsRewardsDay;

        // precision used when distributing allocations
        uint256 precisionMul;
        // the token contract address
        address tokenContract;
        // the identity contract address
        address identityContract;
        /// @dev A record of each staking/unstaking wallet
        mapping (address => UnstakeData) stakingMap;
        /// @dev A record for each allocation by address
        mapping (address => mapping(bytes32 => Allocation)) allocationsMap;
        /// @dev An array to hold allocations keys
        mapping (address => bytes32[]) allocationsArr;
        /// @dev An record for the sum allocated by address
        mapping (address => uint256) allocationsSum;
        bytes32 VALIDATOR_ROLE;
        bytes32 APPLICATION_ROLE;
    }
    /*
    *  Modifiers
    */
    modifier onlyOneConfirmationPerValidatorPerRewardsHash(Data storage _self, bytes32 _rewardsHash) {
        require(
            !_self.dailyRewards.submissions[_rewardsHash].validators[msg.sender],
            "Must be one submission per validator"
        );
         _;
    }

    modifier onlyExistingApplications(Data storage _self, address[] memory _entities) {
        for (uint256 i = 0; i < _entities.length; i++) {
            require(
                _self.applications[_entities[i]].isInitializedState,
                "Application must exist"
            );
        }
        _;
    }

    modifier onlyExistingValidators(Data storage _self, address[] memory _entities) {
        for (uint256 i = 0; i < _entities.length; i++) {
            require(
                _self.validators[_entities[i]].isInitializedState,
                "Validator must exist"
            );
        }
        _;
    }

    modifier onlySelectedValidators(Data storage _self, uint256 _rewardsDay) {
        if (!_usePreviousSelectedRewardsEntityList(_self.selectedValidators, _rewardsDay)) {
            require (
                _self.selectedValidators.current[msg.sender],
                "Must be a current selected validator"
            );
        } else {
            require (
                _self.selectedValidators.previous[msg.sender],
                "Must be a previous selected validator"
            );
        }
        _;
    }

    modifier onlyValidRewardsDay(Data storage _self, uint256 _rewardsDay) {
        require(
            _currentRewardsDay(_self) > _rewardsDay && _rewardsDay > _self.lastValidatorsRewardsDay,
            "Must be for a previous day but after the last rewards day"
        );
         _;
    }

    modifier onlyValidFutureRewardsDay(Data storage _self, uint256 _rewardsDay) {
        require(
            _rewardsDay >= _currentRewardsDay(_self),
            "Must be future rewardsDay"
        );
         _;
    }

    modifier onlyValidAddresses(address _rewardsAddress, address _sidechainAddress) {
        require(
            _rewardsAddress != address(0) &&
            _sidechainAddress != address(0),
            "Must have valid rewards and sidechain addresses"
        );
        _;
    }

    /**
    * @dev The function is called by validators with the calculation of the daily rewards
    * @param _self Data pointer to storage
    * @param _rewardsDay uint256 the rewards day
    * @param _rewardsHash bytes32 hash of the rewards data
    * @param _allValidators bool should the calculation be based on all the validators or just those which submitted
    */
    function calculateValidatorRewards(
        Data storage _self,
        uint256 _rewardsDay,
        bytes32 _rewardsHash,
        bool _allValidators
    )
        public
        view
        returns (uint256)
    {
        uint256 numOfValidators;
        if (_self.dailyRewards.submissions[_rewardsHash].finalizedStatus == 1)
        {
            if (_allValidators) {
                numOfValidators = _requiredValidatorsForValidatorsRewards(_self, _rewardsDay);
                if (numOfValidators > _self.dailyRewards.submissions[_rewardsHash].confirmations) return 0;
            } else {
                numOfValidators = _self.dailyRewards.submissions[_rewardsHash].confirmations;
            }
            uint256 rewardsPerValidator = _getValidatorRewardsDailyAmountPerValidator(_self, _rewardsDay, numOfValidators);
            return rewardsPerValidator;
        }
        return 0;
    }

    /**
    * @dev The function is called by validators with the calculation of the daily rewards
    * @param _self Data pointer to storage
    * @param _rewardsDay uint256 the rewards day
    * @param _rewardsHash bytes32 hash of the rewards data
    * @param _applications address[] array of application addresses getting the daily reward
    * @param _amounts uint256[] array of amounts each app should get
    * @param _currentTotalSupply uint256 current total supply
    */
    function calculateAndFinalizeApplicationRewards(
        Data storage _self,
        uint256 _rewardsDay,
        bytes32 _rewardsHash,
        address[] memory _applications,
        uint256[] memory _amounts,
        uint256 _currentTotalSupply
    )
        public
        onlyValidRewardsDay(_self, _rewardsDay)
        onlyOneConfirmationPerValidatorPerRewardsHash(_self, _rewardsHash)
        onlySelectedValidators(_self, _rewardsDay)
        returns (uint256)
    {
        require(
                _rewardsHashIsValid(_self, _rewardsDay, _rewardsHash, _applications, _amounts),
                "Rewards Hash is invalid"
        );
        if (!_self.dailyRewards.submissions[_rewardsHash].isInitializedState) {
            _self.dailyRewards.submissions[_rewardsHash].isInitializedState = true;
            _self.dailyRewards.submittedRewardsHashes.push(_rewardsHash);
        }
        _self.dailyRewards.submissions[_rewardsHash].validators[msg.sender] = true;
        _self.dailyRewards.submissions[_rewardsHash].validatorsList.push(msg.sender);
        _self.dailyRewards.submissions[_rewardsHash].confirmations++;

        if (_self.dailyRewards.submissions[_rewardsHash].confirmations == _requiredValidatorsForAppRewards(_self, _rewardsDay)) {
            uint256 sum = _validateSubmittedData(_self, _applications, _amounts);
            require(
                sum <= _getMaxAppRewardsDailyAmount(_self, _rewardsDay, _currentTotalSupply),
                "Rewards data is invalid - exceed daily variation"
            );
            _finalizeDailyApplicationRewards(_self, _rewardsDay, _rewardsHash, _currentTotalSupply);
            return sum;
        }
        return 0;
    }

    /**
    * @dev Finalizes the state, rewards Hash, total supply and block timestamp for the day
    * @param _self Data pointer to storage
    * @param _rewardsDay uint256 the rewards day
    * @param _rewardsHash bytes32 the daily rewards hash
    * @param _currentTotalSupply uint256 the current total supply
    */
    function _finalizeDailyApplicationRewards(Data storage _self, uint256 _rewardsDay, bytes32 _rewardsHash, uint256 _currentTotalSupply)
        public
    {
        _self.dailyRewards.totalSupply = _currentTotalSupply;
        _self.dailyRewards.lastConfirmedRewardsHash = _rewardsHash;
        _self.dailyRewards.lastApplicationsRewardsDay = _rewardsDay;
        _self.dailyRewards.submissions[_rewardsHash].finalizedStatus = 1;
    }

    /**
    * @dev Get parameter's value
    * @param _self Data pointer to storage
    * @param _name ParameterName name of the parameter
    * @param _rewardsDay uint256 the rewards day
    */
    function getParameterValue(
        Data storage _self,
        ParameterName _name,
        uint256 _rewardsDay
    )
        public
        view
        returns (uint256)
    {
        if (_rewardsDay >= _self.parameters[uint256(_name)].rewardsDay) {
            return _self.parameters[uint256(_name)].currentValue;
        } else {
            return _self.parameters[uint256(_name)].previousValue;
        }
    }

    /**
    * @dev Allows the controller/owner to update rewards parameters
    * @param _self Data pointer to storage
    * @param _name ParameterName name of the parameter
    * @param _value uint256 new value for the parameter
    * @param _rewardsDay uint256 the rewards day
    */
    function updateParameter(
        Data storage _self,
        ParameterName _name,
        uint256 _value,
        uint256 _rewardsDay
    )
        public
        onlyValidFutureRewardsDay(_self, _rewardsDay)
    {
        if (_rewardsDay <= _self.parameters[uint256(_name)].rewardsDay) {
           _self.parameters[uint256(_name)].currentValue = _value;
           _self.parameters[uint256(_name)].rewardsDay = _rewardsDay;
        } else {
            _self.parameters[uint256(_name)].previousValue = _self.parameters[uint256(_name)].currentValue;
            _self.parameters[uint256(_name)].currentValue = _value;
           _self.parameters[uint256(_name)].rewardsDay = _rewardsDay;
        }
    }

    /**
    * @dev Allows an application to add/update its details
    * @param _self Data pointer to storage
    * @param _entityType RewardedEntityType either application (0) or validator (1)
    * @param _name bytes32 name of the app
    * @param _rewardsAddress address an address for the app to receive the rewards
    * @param _sidechainAddress address the address used for using the sidechain
    */
    function updateEntity(
        Data storage _self,
        RewardedEntityType _entityType,
        bytes32 _name,
        address _rewardsAddress,
        address _sidechainAddress
    )
        public
        onlyValidAddresses(_rewardsAddress, _sidechainAddress)
    {
        if (_entityType == RewardedEntityType.Application) {
            updateApplication(_self, _name, _rewardsAddress, _sidechainAddress);
        } else {
            updateValidator(_self, _name, _rewardsAddress, _sidechainAddress);
        }
    }

    /**
    * @dev Allows an application to add/update its details
    * @param _self Data pointer to storage
    * @param _name bytes32 name of the app
    * @param _rewardsAddress address an address for the app to receive the rewards
    * @param _sidechainAddress address the address used for using the sidechain
    */
    function updateApplication(
        Data storage _self,
        bytes32 _name,
        address _rewardsAddress,
        address _sidechainAddress
    )
        public
        returns (uint256)
    {
        _self.applications[msg.sender].name = _name;
        _self.applications[msg.sender].rewardsAddress = _rewardsAddress;
        _self.applications[msg.sender].sidechainAddress = _sidechainAddress;
        if (!_self.applications[msg.sender].isInitializedState) {
            _self.applicationsList.push(msg.sender);
            _self.applications[msg.sender].isInitializedState = true;
            _self.applications[msg.sender].entityType = RewardedEntityType.Application;
        }
        return uint256(RewardedEntityType.Application);
    }

    /**
    * @dev Allows a validator to add/update its details
    * @param _self Data pointer to storage
    * @param _name bytes32 name of the validator
    * @param _rewardsAddress address an address for the validator to receive the rewards
    * @param _sidechainAddress address the address used for using the sidechain
    */
    function updateValidator(
        Data storage _self,
        bytes32 _name,
        address _rewardsAddress,
        address _sidechainAddress
    )
        public
        returns (uint256)
    {
        _self.validators[msg.sender].name = _name;
        _self.validators[msg.sender].rewardsAddress = _rewardsAddress;
        _self.validators[msg.sender].sidechainAddress = _sidechainAddress;
        if (!_self.validators[msg.sender].isInitializedState) {
            _self.validatorsList.push(msg.sender);
            _self.validators[msg.sender].isInitializedState = true;
            _self.validators[msg.sender].entityType = RewardedEntityType.Validator;
        }
        return uint256(RewardedEntityType.Validator);
    }

    /**
    * @dev Set new validators list
    * @param _self Data pointer to storage
    * @param _rewardsDay uint256 the rewards day from which the list should be active
    * @param _validators address[] array of validators
    */
    function setValidators(
        Data storage _self,
        uint256 _rewardsDay,
        address[] memory _validators
    )
        public
        onlyValidFutureRewardsDay(_self, _rewardsDay)
        onlyExistingValidators(_self, _validators)
    {
        // no need to update the previous if its' the first time or second update in the same day
        if (_rewardsDay > _self.selectedValidators.rewardsDay && _self.selectedValidators.currentList.length > 0)
            _updatePreviousEntityList(_self.selectedValidators);

        _updateCurrentEntityList(_self.selectedValidators, _validators);
        _self.selectedValidators.rewardsDay = _rewardsDay;
    }

   /**
    * @dev Set new applications list
    * @param _self Data pointer to storage
    * @param _rewardsDay uint256 the rewards day from which the list should be active
    * @param _applications address[] array of applications
    */
    function setApplications(
        Data storage _self,
        uint256 _rewardsDay,
        address[] memory _applications
    )
        public
        onlyValidFutureRewardsDay(_self, _rewardsDay)
        onlyExistingApplications(_self, _applications)
    {

        if (_rewardsDay > _self.selectedApplications.rewardsDay && _self.selectedApplications.currentList.length > 0)
                _updatePreviousEntityList(_self.selectedApplications);
        _updateCurrentEntityList(_self.selectedApplications, _applications);
        _self.selectedApplications.rewardsDay = _rewardsDay;
    }

    /**
    * @dev Get applications or validators list
    * @param _self Data pointer to storage
    * @param _entityType RewardedEntityType either application (0) or validator (1)
    * @param _rewardsDay uint256 the rewards day to determine which list to get
    */
    function getEntities(
        Data storage _self,
        RewardedEntityType _entityType,
        uint256 _rewardsDay
    )
        public
        view
        returns (address[] memory)
    {
        if (_entityType == RewardedEntityType.Application) {
            if (!_usePreviousSelectedRewardsEntityList(_self.selectedApplications, _rewardsDay)) {
                return _self.selectedApplications.currentList;
            } else {
                return _self.selectedApplications.previousList;
            }
        } else {
            if (!_usePreviousSelectedRewardsEntityList(_self.selectedValidators, _rewardsDay)) {
                return _self.selectedValidators.currentList;
            } else {
                return _self.selectedValidators.previousList;
            }
        }
    }

    /**
    * @dev Allows getting total allocated per application user.
    * This function can be used to get total allocated, total allocated to an app and total allocated to a specific application user
    * @param _self Data pointer to storage
    * @param _wallet address of allocating wallet
    * @param _applicationId address (optional pass 0x address) the application main address (used to setup the application)
    * @param _userId bytes32 (optional pass empty) identification of the user
    * @return uint256 Amount allocated
    */
    function getAllocated(
        Data storage _self,
        address _wallet,
        address _applicationId,
        bytes32 _userId
    )
        public
        view
        returns (uint256)
    {
        bytes32 appUserId = _getApplicationUserId(_applicationId, _userId);
        uint256 sum = 0;
        if (_applicationId != address(0) && _userId[0] != 0) {
            sum = _self.allocationsMap[_wallet][appUserId].amount;
        } else {
            for (uint i = 0; i < _self.allocationsArr[_wallet].length; i++) {
                if (_applicationId != address(0)) {
                    if (_self.allocationsMap[_wallet][_self.allocationsArr[_wallet][i]].applicationUser.appId == _applicationId) {
                        sum = sum.add(_self.allocationsMap[_wallet][_self.allocationsArr[_wallet][i]].amount);
                    }
                } else {
                    sum = sum.add(_self.allocationsMap[_wallet][_self.allocationsArr[_wallet][i]].amount);
                }
            }
        }
        return sum;
    }

    /**
    * @dev Allows a user to restake from unstaked state after restake cooldown
    * @param _self Data pointer to storage
    * @param _wallet address of allocating wallet
    * @param _amount uint256 amount to unstake
    */
    function restake(
        Data storage _self,
        address _wallet,
        uint256 _amount
    )
        public
    {
        require(
            _self.stakingMap[_wallet].amountUnstaked > 0,
            "Cannot restake - nothing to restake"
        );
        uint256 rewardsDay = _currentRewardsDay(_self);
        require(
            rewardsDay.sub(_self.stakingMap[_wallet].unstakeRewardsDay) > getParameterValue(_self,ParameterName.RestakeCooldownPeriodDays, rewardsDay),
            "Cannot restake - in cooldown"
        );
        _self.stakingMap[_wallet].amountUnstaked = _self.stakingMap[_wallet].amountUnstaked.sub(_amount);
    }

    /**
    * @dev Allows a user to unstake props.
    * @param _self Data pointer to storage
    * @param _wallet address of wallet
    * @param _amount uint256 amount to unstake
    * @param _applicationId address (optional pass 0x address) the application main address (used to setup the application)
    * @param _userId bytes32 (optional pass empty) identification of the user
    * @param _delegatee address of delegatee
    * @param _rewardsDay uint256 the rewards day
    */
    function unstake(
        Data storage _self,
        address _wallet,
        uint256 _amount,
        address _applicationId,
        bytes32 _userId,
        address _delegatee,
        uint256 _rewardsDay
    )
        public
    {

        //Data for withdraw
        _self.stakingMap[_wallet].unstakeRewardsDay = _rewardsDay;
        _self.stakingMap[_wallet].amountUnstaked = _self.stakingMap[_wallet].amountUnstaked.add(_amount);
        if (_delegatee != address(0)) {
            _removeFromAllocations(_self, _delegatee, _amount, _rewardsDay);
        } else {
            _allocateToAppUser(_self, _wallet, _amount, _applicationId, _userId, _rewardsDay, true);
        }
    }

    /**
    * @dev Allows a user to unstake props.
    * @param _self Data pointer to storage
    * @param _wallet address of wallet
    * @param _rewardsDay uint256 the rewards day
    */
    function withdraw(
        Data storage _self,
        address _wallet,
        uint256 _rewardsDay
    )
        public
    {
        require(
            _self.stakingMap[_wallet].amountUnstaked > 0,
            "Nothing to withdraw"
        );
        require(
            _rewardsDay.sub(_self.stakingMap[_wallet].unstakeRewardsDay) > getParameterValue(_self, ParameterName.WithdrawCooldownPeriodDays, _rewardsDay),
            "Cooldown period is not over"
        );
        _self.stakingMap[_wallet].amountUnstaked = 0;
    }

    /**
    * @dev Public function to allocate unallocated voting power
    * @param _self Data pointer to storage
    * @param _wallet address of allocating wallet
    * @param _amount uint256 amount to be allocated
    * @param _applicationId address the application main address (used to setup the application)
    * @param _userId bytes32 identification of the user
    */
    function allocateToAppUser(
        Data storage _self,
        address _wallet,
        uint256 _amount,
        address _applicationId,
        bytes32 _userId
    )
        public
    {
        require(
            _applicationId != address(0),
            "Must allocate to non 0x address"
        );
        bytes32 zeroAppUserId = _getApplicationUserId(address(0), "");
        require(
            _self.allocationsMap[_wallet][zeroAppUserId].amount >= _amount,
            "Cannot allocate more than unallocated"
        );
        uint256 rewardsDay = _currentRewardsDay(_self);
        // decrease zero appUserId allocation
        _allocateToAppUser(_self, _wallet, _amount, address(0), "", rewardsDay, true);
        // allocate to specified application user
        _allocateToAppUser(_self, _wallet, _amount, _applicationId, _userId, rewardsDay, false);
    }

    /**
    * @dev Library stake call to be used by stake or settle
    * @param _self Data pointer to storage
    * @param _wallet address where to send the props to
    * @param _amount uint256 amount to be staked
    * @param _applicationId address (optional pass 0x address) the application main address (used to setup the application)
    * @param _userId bytes32 (optional pass empty) identification of the user
    * @param _rewardsDay uint256 amount to be staked
    * @param _delegatee address delegatee
    */
    function stake(
        Data storage _self,
        address _wallet,
        uint256 _amount,
        address _applicationId,
        bytes32 _userId,
        uint256 _rewardsDay,
        address _delegatee
    )
        public
    {

        _self.stakingMap[_wallet].stakeRewardsDay = _rewardsDay;
        _self.stakingMap[_wallet].interestRate = getParameterValue(_self, ParameterName.StakingInterestRate, _rewardsDay);
        // if no app user is given put in un-allocated pool
        // if delegated assign to unallocated regardless of staked requested application user
        if (_delegatee != address(0)) {
            _allocateToAppUser(_self, _delegatee, _amount, address(0), "", _rewardsDay, false);
        } else {
            _allocateToAppUser(_self, _wallet, _amount, _applicationId, _userId, _rewardsDay, false);
        }
        // Older code below here for reference when we would automatically distribute it
        /*
        if (_applicationId == address(0)) {
            _distributeAppUserAllocations(_to, amountToAllocate, rewardsDay, false);
        } else {
            _allocateToAppUser(_to, amountToAllocate, _applicationId, _userId, rewardsDay, false);
        }
        */
    }


    /**
    * @dev Internal remove an allocation amount from unallocated and proportionally from all other allocations
    * @param _self Data pointer to storage
    * @param _wallet address of allocating wallet
    * @param _amount uint256 amount to be allocated
    * @param _rewardsDay uint256 the rewards day
    */
    function _removeFromAllocations(
        Data storage _self,
        address _wallet,
        uint256 _amount,
        uint256 _rewardsDay
    )
        internal
    {
        bytes32 zeroAppUserId = _getApplicationUserId(address(0), "");
        // first try to remove all from unallocated pool
        uint256 unallocatedAmount = _self.allocationsMap[_wallet][zeroAppUserId].amount;
        if (unallocatedAmount >= _amount) {
            _allocateToAppUser(_self, _wallet, _amount, address(0), "", _rewardsDay, true);
        } else {
            //take whatever is unallocated and the rest proportionally
            if (unallocatedAmount > 0) {
                _allocateToAppUser(_self, _wallet, unallocatedAmount, address(0), "", _rewardsDay, true);
            }
            if (_self.allocationsArr[_wallet].length > 0) {
                _distributeAppUserAllocations(_self, _wallet, _amount.sub(unallocatedAmount), _self.allocationsMap[_wallet], _self.allocationsArr[_wallet], _rewardsDay, true);
            }
        }
    }

    /**
    * @dev Internal allocate to user call
    * @param _self Data pointer to storage
    * @param _wallet address of allocating wallet
    * @param _amount uint256 amount to be allocated
    * @param _applicationId address the application main address (used to setup the application)
    * @param _userId bytes32 identification of the user
    * @param _rewardsDay uint256 the rewards day
    * @param _subtract bool should the amount be subtracted
    */
    function _allocateToAppUser(
        Data storage _self,
        address _wallet,
        uint256 _amount,
        address _applicationId,
        bytes32 _userId,
        uint256 _rewardsDay,
        bool _subtract
    )
        internal
    {
        bytes32 appUserId = _getApplicationUserId(_applicationId, _userId);
        if (_subtract) {
            require(
                _self.allocationsMap[_wallet][appUserId].amount > _amount,
                "Cannot subtract not enough allocated"
            );
        }

        if (!_self.allocationsMap[_wallet][appUserId].isInitialized) {
            _self.allocationsMap[_wallet][appUserId].isInitialized = true;
            _self.allocationsArr[_wallet].push(appUserId);
            _self.allocationsMap[_wallet][appUserId].arrIndex = _self.allocationsArr[_wallet].length - 1;
            _self.allocationsMap[_wallet][appUserId].applicationUser = ApplicationUser(_applicationId, _userId);
        }
        if (!_subtract) {
            _self.allocationsMap[_wallet][appUserId].amount = _self.allocationsMap[_wallet][appUserId].amount.add(_amount);
            _self.allocationsSum[_wallet] = _self.allocationsSum[_wallet].add(_amount);
        } else {
            _self.allocationsMap[_wallet][appUserId].amount = _self.allocationsMap[_wallet][appUserId].amount.sub(_amount);
            _self.allocationsSum[_wallet] = _self.allocationsSum[_wallet].sub(_amount);
            if (_self.allocationsMap[_wallet][appUserId].amount == 0) { // if removed all allocation delete the entry and reorganize array
                _deleteAllocation(_self, _wallet, appUserId);
            }
        }

        emit AllocationChanged(
            _wallet,
            _rewardsDay,
            _applicationId,
            _userId,
            _self.allocationsMap[_wallet][appUserId].amount,
            _amount
        );
    }

    /**
    * @dev Internal delete allocation when no longer needed and reorganize array
    * @param _self Data pointer to storage
    * @param _wallet address wallet
    * @param _appUserId bytes32 key generated from appId + userId
    */
    function _deleteAllocation(
        Data storage _self,
        address _wallet,
        bytes32 _appUserId
    )
        internal
    {
        _self.allocationsMap[_wallet][_appUserId].isInitialized = false;
        _self.allocationsMap[_wallet][_appUserId].amount = 0;
        uint256 arrIndex = _self.allocationsMap[_wallet][_appUserId].arrIndex;
        uint256 len = _self.allocationsArr[_wallet].length;
        bool moveLastItemToNewPosition = arrIndex < (len - 1);
        if (moveLastItemToNewPosition) {
            _self.allocationsMap[_wallet][_self.allocationsArr[_wallet][len - 1]].arrIndex = arrIndex;
            _self.allocationsArr[_wallet][arrIndex] = _self.allocationsArr[_wallet][len - 1];
            _self.allocationsArr[_wallet].pop();
        } else {
            _self.allocationsArr[_wallet].pop();
        }
    }

    /**
    * @dev Internal redistribute allocations on amount change
    * @param _self Data pointer to storage
    * @param _wallet address of allocating wallet
    * @param _amount uint256 amount to be allocated
    * @param _allocations mapping(bytes32 => Allocation) wallets allocations mapping
    * @param _allocationsArr bytes32[] wallet allocations array
    * @param _rewardsDay uint256 the rewards day
    * @param _subtract bool should the amount be subtracted
    */

    function _distributeAppUserAllocations(
        Data storage _self,
        address _wallet,
        uint256 _amount,
        mapping(bytes32 => Allocation) storage _allocations,
        bytes32[] memory _allocationsArr,
        uint256 _rewardsDay,
        bool _subtract
    )
        internal
    {
        if (_allocationsArr.length == 1) { // one app - nothing to distribute just one application user will get it
            _allocateToAppUser(
                _self,
                _wallet,
                _amount,
                _allocations[_allocationsArr[0]].applicationUser.appId,
                _allocations[_allocationsArr[0]].applicationUser.userId,
                _rewardsDay,
                _subtract
            );
        } else {
            uint256[MAX_APPLICATION_USER_PER_WALLET] memory ratios;

            for (uint i = 0; i < _allocationsArr.length; i++) {
                ratios[i] = _allocations[_allocationsArr[i]].amount.mul(_self.precisionMul).div(_self.allocationsSum[_wallet]);
            }
            uint256 tempSum = 0;
            for (uint i = 0; i < _allocationsArr.length; i++) {
                uint256 amountWithRatio;
                if (i < (_allocationsArr.length-1)) {
                    amountWithRatio = _amount.mul(ratios[i]).div(_self.precisionMul);
                } else {
                    amountWithRatio = tempSum.sub(_amount);
                }
                _allocateToAppUser(
                    _self,
                    _wallet,
                    amountWithRatio,
                    _allocations[_allocationsArr[i]].applicationUser.appId,
                    _allocations[_allocationsArr[i]].applicationUser.userId,
                    _rewardsDay,
                    _subtract
                );
                tempSum = tempSum.add(amountWithRatio);
            }
        }
    }

    /**
    * @dev Public function triggered by collectInterest function
    * @param _self Data pointer to storage
    * @param _wallet address of allocating wallet
    * @param _amount uint256 principal
    * @return uint256, uint256 The gained interest, rewardsday
    */
    function _collectInterest(
        Data storage _self,
        address _wallet,
        uint256 _amount
    )
        public
        returns(uint256, uint256)
    {
        uint256 rewardsDay = _currentRewardsDay(_self);
        uint256 daysStaked = rewardsDay.sub(_self.stakingMap[_wallet].stakeRewardsDay);
        uint256 interestGained = _calculateInterest(_amount,daysStaked,_self.stakingMap[_wallet].interestRate);
        _self.stakingMap[_wallet].stakeRewardsDay = rewardsDay;
        _self.stakingMap[_wallet].interestRate = getParameterValue(_self, ParameterName.StakingInterestRate, rewardsDay);
        // _distributeAppUserAllocations(_wallet, interestGained, rewardsDay, false);
        return (interestGained,rewardsDay);
    }

    /**
    * @dev Internal stake call to be used by stake or settle using Daily Compound Interest = [Start Amount * (1 + (Interest Rate / 365)) ^ (n * 365)] – Start Amount
    * @param _principal uint256 amount originally staked
    * @param _days uint256 days for which to calculate interest
    * @param _interestRate uint256 days for which to calculate interest
    * @return uint256 The gained interest
    */
    function _calculateInterest(
        uint256 _principal,
        uint256 _days,
        uint256 _interestRate
    )
        internal
        pure
        returns(uint256)
    {
        uint256 interestGained = _principal.mul(
            (1 + _interestRate.div(1e16).div(365))**(_days*365)
        ).sub(_principal);
        return interestGained;
    }

    /**
     * @dev Return a unique identified for application userId combination
     * @param _applicationId address
     * @param _userId bytes32
     * @return bytes32 unique identifier
     */
    function _getApplicationUserId(
        address _applicationId,
        bytes32 _userId
    )
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(_applicationId, _userId));
    }

    /**
    * @dev Get which entity list to use. If true use previous if false use current
    * @param _rewardedEntitylist RewardedEntityList pointer to storage
    * @param _rewardsDay uint256 the rewards day to determine which list to get
    */
    function _usePreviousSelectedRewardsEntityList(RewardedEntityList memory _rewardedEntitylist, uint256 _rewardsDay)
        internal
        pure
        returns (bool)
    {
        if (_rewardsDay >= _rewardedEntitylist.rewardsDay) {
            return false;
        } else {
            return true;
        }
    }

    /**
    * @dev Checks how many validators are needed for app rewards
    * @param _self Data pointer to storage
    * @param _rewardsDay uint256 the rewards day
    * @param _currentTotalSupply uint256 current total supply
    */
    function _getMaxAppRewardsDailyAmount(
        Data storage _self,
        uint256 _rewardsDay,
        uint256 _currentTotalSupply
    )
        public
        view
        returns (uint256)
    {
        return ((_self.maxTotalSupply.sub(_currentTotalSupply)).mul(
        getParameterValue(_self, ParameterName.ApplicationRewardsPercent, _rewardsDay)).mul(
        getParameterValue(_self, ParameterName.ApplicationRewardsMaxVariationPercent, _rewardsDay))).div(1e16);
    }


    /**
    * @dev Checks how many validators are needed for app rewards
    * @param _self Data pointer to storage
    * @param _rewardsDay uint256 the rewards day
    * @param _numOfValidators uint256 number of validators
    */
    function _getValidatorRewardsDailyAmountPerValidator(
        Data storage _self,
        uint256 _rewardsDay,
        uint256 _numOfValidators
    )
        public
        view
        returns (uint256)
    {
        return (((_self.maxTotalSupply.sub(_self.dailyRewards.totalSupply)).mul(
        getParameterValue(_self, ParameterName.ValidatorRewardsPercent, _rewardsDay))).div(1e8)).div(_numOfValidators);
    }

    /**
    * @dev Checks if app daily rewards amount is valid
    * @param _self Data pointer to storage
    * @param _applications address[] array of application addresses getting the daily rewards
    * @param _amounts uint256[] array of amounts each app should get
    */
    function _validateSubmittedData(
        Data storage _self,
        address[] memory _applications,
        uint256[] memory _amounts
    )
        public
        view
        returns (uint256)
    {
        uint256 sum;
        bool valid = true;
        for (uint256 i = 0; i < _amounts.length; i++) {
            sum = sum.add(_amounts[i]);
            if (!_self.applications[_applications[i]].isInitializedState) valid = false;
        }
        require(
                sum > 0 && valid,
                "Sum zero or none existing app submitted"
        );
        return sum;
    }

    /**
    * @dev Checks if submitted data matches rewards hash
    * @param _rewardsDay uint256 the rewards day
    * @param _rewardsHash bytes32 hash of the rewards data
    * @param _applications address[] array of application addresses getting the daily rewards
    * @param _amounts uint256[] array of amounts each app should get
    */
    function _rewardsHashIsValid(
        Data storage _self,
        uint256 _rewardsDay,
        bytes32 _rewardsHash,
        address[] memory _applications,
        uint256[] memory _amounts
    )
        public
        view
        returns (bool)
    {
        bool nonActiveApplication = false;
        if (!_usePreviousSelectedRewardsEntityList(_self.selectedApplications, _rewardsDay)) {
            for (uint256 i = 0; i < _applications.length; i++) {
                if (!_self.selectedApplications.current[_applications[i]]) {
                    nonActiveApplication = true;
                }
            }
        } else {
            for (uint256 j = 0; j < _applications.length; j++) {
                if (!_self.selectedApplications.previous[_applications[j]]) {
                    nonActiveApplication = true;
                }
            }
        }
        return
            _applications.length > 0 &&
            _applications.length == _amounts.length &&
            !nonActiveApplication &&
            keccak256(abi.encodePacked(_rewardsDay, _applications.length, _amounts.length, _applications, _amounts)) == _rewardsHash;
    }

    /**
    * @dev Checks how many validators are needed for app rewards
    * @param _self Data pointer to storage
    * @param _rewardsDay uint256 the rewards day
    */
    function _requiredValidatorsForValidatorsRewards(Data storage _self, uint256 _rewardsDay)
        public
        view
        returns (uint256)
    {
        if (!_usePreviousSelectedRewardsEntityList(_self.selectedValidators, _rewardsDay)) {
            return _self.selectedValidators.currentList.length;
        } else {
            return _self.selectedValidators.previousList.length;
        }
    }

    /**
    * @dev Checks how many validators are needed for app rewards
    * @param _self Data pointer to storage
    * @param _rewardsDay uint256 the rewards day
    */
    function _requiredValidatorsForAppRewards(Data storage _self, uint256 _rewardsDay)
        public
        view
        returns (uint256)
    {
        if (!_usePreviousSelectedRewardsEntityList(_self.selectedValidators, _rewardsDay)) {
            return ((_self.selectedValidators.currentList.length.mul(getParameterValue(_self, ParameterName.ValidatorMajorityPercent, _rewardsDay))).div(1e8)).add(1);
        } else {
            return ((_self.selectedValidators.previousList.length.mul(getParameterValue(_self, ParameterName.ValidatorMajorityPercent, _rewardsDay))).div(1e8)).add(1);
        }
    }

    /**
    * @dev Get rewards day from block.timestamp
    * @param _self Data pointer to storage
    */
    function _currentRewardsDay(Data storage _self)
        public
        view
        returns (uint256)
    {
        //the the start time - floor timestamp to previous midnight divided by seconds in a day will give the rewards day number
       if (_self.minSecondsBetweenDays > 0) {
            return (block.timestamp.sub(_self.rewardsStartTimestamp)).div(_self.minSecondsBetweenDays).add(1);
        } else {
            return 0;
        }
    }

    /**
    * @dev Update current daily applications list.
    * If new, push.
    * If same size, replace
    * If different size, delete, and then push.
    * @param _rewardedEntitylist RewardedEntityList pointer to storage
    * @param _entities address[] array of entities
    */
    //_updateCurrentEntityList(_rewardedEntitylist, _entities,_rewardedEntityType),
    function _updateCurrentEntityList(
        RewardedEntityList storage _rewardedEntitylist,
        address[] memory _entities
    )
        internal
    {
        bool emptyCurrentList = _rewardedEntitylist.currentList.length == 0;
        if (!emptyCurrentList && _rewardedEntitylist.currentList.length != _entities.length) {
            _deleteCurrentEntityList(_rewardedEntitylist);
            emptyCurrentList = true;
        }

        for (uint256 i = 0; i < _entities.length; i++) {
            if (emptyCurrentList) {
                _rewardedEntitylist.currentList.push(_entities[i]);
            } else {
                _rewardedEntitylist.currentList[i] = _entities[i];
            }
            _rewardedEntitylist.current[_entities[i]] = true;
        }
    }

    /**
    * @dev Update previous daily list
    * @param _rewardedEntitylist RewardedEntityList pointer to storage
    */
    function _updatePreviousEntityList(RewardedEntityList storage _rewardedEntitylist)
        internal
    {
        bool emptyPreviousList = _rewardedEntitylist.previousList.length == 0;
        if (
            !emptyPreviousList &&
            _rewardedEntitylist.previousList.length != _rewardedEntitylist.currentList.length
        ) {
            _deletePreviousEntityList(_rewardedEntitylist);
            emptyPreviousList = true;
        }
        for (uint256 i = 0; i < _rewardedEntitylist.currentList.length; i++) {
            if (emptyPreviousList) {
                _rewardedEntitylist.previousList.push(_rewardedEntitylist.currentList[i]);
            } else {
                _rewardedEntitylist.previousList[i] = _rewardedEntitylist.currentList[i];
            }
            _rewardedEntitylist.previous[_rewardedEntitylist.currentList[i]] = true;
        }
    }

    /**
    * @dev Delete existing values from the current list
    * @param _rewardedEntitylist RewardedEntityList pointer to storage
    */
    function _deleteCurrentEntityList(RewardedEntityList storage _rewardedEntitylist)
        internal
    {
        for (uint256 i = 0; i < _rewardedEntitylist.currentList.length ; i++) {
             delete _rewardedEntitylist.current[_rewardedEntitylist.currentList[i]];
        }
        delete  _rewardedEntitylist.currentList;
    }

    /**
    * @dev Delete existing values from the previous applications list
    * @param _rewardedEntitylist RewardedEntityList pointer to storage
    */
    function _deletePreviousEntityList(RewardedEntityList storage _rewardedEntitylist)
        internal
    {
        for (uint256 i = 0; i < _rewardedEntitylist.previousList.length ; i++) {
            delete _rewardedEntitylist.previous[_rewardedEntitylist.previousList[i]];
        }
        delete _rewardedEntitylist.previousList;
    }

    /**
    * @dev Deletes rewards day submission data
    * @param _self Data pointer to storage
    * @param _rewardsHash bytes32 rewardsHash
    */
    function _resetDailyRewards(
        Data storage _self,
        bytes32 _rewardsHash
    )
        public
    {
         _self.lastValidatorsRewardsDay = _self.dailyRewards.lastApplicationsRewardsDay;
        for (uint256 j = 0; j < _self.dailyRewards.submissions[_rewardsHash].validatorsList.length; j++) {
            delete(
                _self.dailyRewards.submissions[_rewardsHash].validators[_self.dailyRewards.submissions[_rewardsHash].validatorsList[j]]
            );
        }
            delete _self.dailyRewards.submissions[_rewardsHash].validatorsList;
            _self.dailyRewards.submissions[_rewardsHash].confirmations = 0;
            _self.dailyRewards.submissions[_rewardsHash].finalizedStatus = 0;
            _self.dailyRewards.submissions[_rewardsHash].isInitializedState = false;
    }
}