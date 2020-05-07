pragma solidity ^0.5.16;

// import "node_modules/@openzeppelin/contracts/token/ERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/ERC20Detailed.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/ownership/Ownable.sol";
// import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "./IPropsToken.sol";
import { PropsRewardsLib } from "./PropsRewardsLib.sol";

/**
 * @title Staking PROPS Token
 * @dev Staking PROPS token contract
 * sPROPS are divisible by 1e18 base
 * units referred to as 'AttosPROPS'.
 *
 * sPROPS are displayed using 18 decimal places of precision.
 *
 * 1 sPROPS is equivalent to:
 *   1 * 1e18 == 1e18 == One Quintillion AttosPROPS
 *
 *

 */

contract PropsRewards is Initializable, ERC20, ERC20Detailed, Ownable { /* AccessControl {*/
    using SafeMath for uint256;

    event DailyRewardsSubmitted(
        uint256 indexed rewardsDay,
        bytes32 indexed rewardsHash,
        address indexed validator
    );

    event DailyRewardsApplicationsMinted(
        uint256 indexed rewardsDay,
        bytes32 indexed rewardsHash,
        uint256 numOfApplications,
        uint256 amount
    );

    event DailyRewardsValidatorsMinted(
        uint256 indexed rewardsDay,
        bytes32 indexed rewardsHash,
        uint256 numOfValidators,
        uint256 amount
    );

    event EntityUpdated(
        address indexed id,
        PropsRewardsLib.RewardedEntityType indexed entityType,
        bytes32 name,
        address rewardsAddress,
        address indexed sidechainAddress
    );

    event ParameterUpdated(
        PropsRewardsLib.ParameterName param,
        uint256 newValue,
        uint256 oldValue,
        uint256 rewardsDay
    );

    event ValidatorsListUpdated(
        address[] validatorsList,
        uint256 indexed rewardsDay
    );

    event ApplicationsListUpdated(
        address[] applicationsList,
        uint256 indexed rewardsDay
    );

    event Settlement(
        address indexed applicationId,
        bytes32 indexed userId,
        address indexed to,
        uint256 amount,
        address rewardsAddress
    );

    event Stake(
        address indexed wallet,
        uint256 indexed rewardsDay,
        uint256 amount,
        uint256 interestRate
    );

    event Unstake(
        address indexed wallet,
        uint256 indexed rewardsDay,
        uint256 amount,
        uint256 interestGained
    );

    event Withdraw(
        address indexed wallet,
        uint256 indexed rewardsDay,
        uint256 amount,
        uint256 interestCollected
    );

    event DelegateChanged(
        address indexed delegator,
        address indexed fromDelegate,
        address indexed toDelegate
    );

    event DelegateVotesChanged(
        address indexed delegate,
        uint previousBalance,
        uint newBalance
    );

    /*
    *  Structs
    */

    /// @dev Represents an application user
    struct ApplicationUser {
        address appId;
        bytes32 userId;
    }

    /// @dev Represents staking meta data
    struct UnstakeData {
        uint256 stakeRewardsDay;
        uint256 unstakeRewardsDay;
        uint256 amount;        
        uint256 interestOwed;
        uint256 interestRate; //in pphm
    }

    /// @dev A checkpoint for marking number of votes from a given block
    struct Checkpoint {
        uint32 fromBlock;
        uint256 votes;
    }

    /*
    *  Storage
    */

    PropsRewardsLib.Data internal rewardsLibData;
    uint256 public maxTotalSupply;
    uint256 public rewardsStartTimestamp;
    uint256 public secondsBetweenDays; // for test networks the option to make each rewards day shorter
    address public tokenContract;
    address public identityContract;
    /// @dev A record of each staking/unstaking wallet
    mapping (address => UnstakeData) stakingMap;
    /// @dev A record of each accounts delegate
    mapping (address => address) public delegates;
    /// @dev A record of votes checkpoints for each account, by index
    mapping (address => mapping (uint32 => Checkpoint)) public checkpoints;
    /// @dev The number of checkpoints for each account
    mapping (address => uint32) public numCheckpoints;
     /// @dev The EIP-712 typehash for the contract's domain
    bytes32 public constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");
    /// @dev The EIP-712 typehash for the delegation struct used by the contract
    bytes32 public constant DELEGATION_TYPEHASH = keccak256("Delegation(address delegatee,uint256 nonce,uint256 expiry)");
    /// @dev A record of states for signing / validating signatures
    mapping (address => uint) public nonces;

    
    // bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    // bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    // bytes32 public constant APPLICATION_ROLE = keccak256("APPLICATION_ROLE");

    /**
    * @dev Initializer function. Called only once when a proxy for the contract is created.
    * @param _admin address that will act as the admin role
    * @param _tokenContract address of the props token contract
    * @param _identityContract address of the identity contract
    * @param _minSecondsBetweenDays uint256 seconds required to pass between consecutive rewards day
    * @param _rewardsStartTimestamp uint256 day 0 timestamp
    */
    function initialize(
        address _admin,
        address _tokenContract,
        address _identityContract,
        uint256 _minSecondsBetweenDays,
        uint256 _rewardsStartTimestamp
    )
    public
    initializer
    {
        // _setupDecimals(18);
        // _setupRole(DEFAULT_ADMIN_ROLE, _admin);
        uint8 decimals = 18;
        tokenContract = _tokenContract;
        identityContract = _identityContract;
        Ownable.initialize(_admin);
        ERC20Detailed.initialize("Props Staking Token", "sPROPS", decimals);
        PropsRewardsLib.updateParameter(rewardsLibData, PropsRewardsLib.ParameterName.ApplicationRewardsPercent, 34750, 0);
        // // ApplicationRewardsMaxVariationPercent pphm ==> 150%
        PropsRewardsLib.updateParameter(rewardsLibData, PropsRewardsLib.ParameterName.ApplicationRewardsMaxVariationPercent, 150 * 1e6, 0);
        // // ValidatorMajorityPercent pphm ==> 50%
        PropsRewardsLib.updateParameter(rewardsLibData, PropsRewardsLib.ParameterName.ValidatorMajorityPercent, 50 * 1e6, 0);
        //  // ValidatorRewardsPercent pphm ==> 0.001829%
        PropsRewardsLib.updateParameter(rewardsLibData, PropsRewardsLib.ParameterName.ValidatorRewardsPercent, 1829, 0);
        //  // StakingInterestRate pphm ==> 0.01%
        PropsRewardsLib.updateParameter(rewardsLibData, PropsRewardsLib.ParameterName.StakingInterestRate, 10000, 0);
        //  // UnstakingCooldownPeriodDays days ==> 30
        PropsRewardsLib.updateParameter(rewardsLibData, PropsRewardsLib.ParameterName.UnstakingCooldownPeriodDays, 30, 0);

        // max total supply is 1,000,000,000 PROPS specified in AttoPROPS
        rewardsLibData.maxTotalSupply = maxTotalSupply = 1 * 1e9 * (10 ** uint256(decimals));
        rewardsLibData.rewardsStartTimestamp = rewardsStartTimestamp = _rewardsStartTimestamp;
        rewardsLibData.minSecondsBetweenDays = secondsBetweenDays = _minSecondsBetweenDays;
    }

    /**
    * @dev Set new validators list
    * @param _rewardsDay uint256 the rewards day from which this change should take effect
    * @param _validators address[] array of validators
    */
    function setValidators(uint256 _rewardsDay, address[] memory _validators)
        public
        onlyOwner
    {
        PropsRewardsLib.setValidators(rewardsLibData, _rewardsDay, _validators);
        emit ValidatorsListUpdated(_validators, _rewardsDay);
    }

    /**
    * @dev Set new applications list
    * @param _rewardsDay uint256 the rewards day from which this change should take effect
    * @param _applications address[] array of applications
    */
    function setApplications(uint256 _rewardsDay, address[] memory _applications)
        public
        onlyOwner
    {
        PropsRewardsLib.setApplications(rewardsLibData, _rewardsDay, _applications);
        emit ApplicationsListUpdated(_applications, _rewardsDay);
    }

    /**
    * @dev Get the applications or validators list
    * @param _entityType RewardedEntityType either application (0) or validator (1)
    * @param _rewardsDay uint256 the rewards day to use for this value
    */
    function getEntities(PropsRewardsLib.RewardedEntityType _entityType, uint256 _rewardsDay)
        public
        view
        returns (address[] memory)
    {
        return PropsRewardsLib.getEntities(rewardsLibData, _entityType, _rewardsDay);
    }

    /**
    * @dev The function is called by validators with the calculation of the daily rewards
    * @param _rewardsDay uint256 the rewards day
    * @param _rewardsHash bytes32 hash of the rewards data
    * @param _applications address[] array of application addresses getting the daily reward
    * @param _amounts uint256[] array of amounts each app should get
    */
    function submitDailyRewards(
        uint256 _rewardsDay,
        bytes32 _rewardsHash,
        address[] memory _applications,
        uint256[] memory _amounts
    )
        public
    {
        // if submission is for a new day check if previous day validator rewards were given if not give to participating ones
        if (_rewardsDay > rewardsLibData.dailyRewards.lastApplicationsRewardsDay) {
            uint256 previousDayValidatorRewardsAmount = PropsRewardsLib.calculateValidatorRewards(
                rewardsLibData,
                rewardsLibData.dailyRewards.lastApplicationsRewardsDay,
                rewardsLibData.dailyRewards.lastConfirmedRewardsHash,
                false
            );
            if (previousDayValidatorRewardsAmount > 0) {
                _mintDailyRewardsForValidators(rewardsLibData.dailyRewards.lastApplicationsRewardsDay, rewardsLibData.dailyRewards.lastConfirmedRewardsHash, previousDayValidatorRewardsAmount);
            }
        }
        // check and give application rewards if majority of validators agree
        uint256 appRewardsSum = PropsRewardsLib.calculateAndFinalizeApplicationRewards(
            rewardsLibData,
            _rewardsDay,
            _rewardsHash,
            _applications,
            _amounts,
            this.totalSupply()
        );
        if (appRewardsSum > 0) {
            _mintDailyRewardsForApps(_rewardsDay, _rewardsHash, _applications, _amounts, appRewardsSum);
        }

        // check and give validator rewards if all validators submitted
        uint256 validatorRewardsAmount = PropsRewardsLib.calculateValidatorRewards(
            rewardsLibData,
            _rewardsDay,
            _rewardsHash,
            true
        );
        if (validatorRewardsAmount > 0) {
            _mintDailyRewardsForValidators(_rewardsDay, _rewardsHash, validatorRewardsAmount);
        }

        emit DailyRewardsSubmitted(_rewardsDay, _rewardsHash, msg.sender);
    }

    /**
    * @dev Allows getting a parameter value based on timestamp
    * @param _name ParameterName name of the parameter
    * @param _rewardsDay uint256 starting when should this parameter use the current value
    */
    function getParameter(
        PropsRewardsLib.ParameterName _name,
        uint256 _rewardsDay
    )
        public
        view
        returns (uint256)
    {
        return PropsRewardsLib.getParameterValue(rewardsLibData, _name, _rewardsDay);
    }

    /**
    * @dev Allows the controller/owner to update rewards parameters
    * @param _name ParameterName name of the parameter
    * @param _value uint256 new value for the parameter
    * @param _rewardsDay uint256 starting when should this parameter use the current value
    */
    function updateParameter(
        PropsRewardsLib.ParameterName _name,
        uint256 _value,
        uint256 _rewardsDay
    )
        public
        onlyOwner
    {
        PropsRewardsLib.updateParameter(rewardsLibData, _name, _value, _rewardsDay);
        emit ParameterUpdated(
            _name,
            rewardsLibData.parameters[uint256(_name)].currentValue,
            rewardsLibData.parameters[uint256(_name)].previousValue,
            rewardsLibData.parameters[uint256(_name)].rewardsDay
        );
    }

    /**
    * @dev Allows an application or validator to add/update its details
    * @param _entityType RewardedEntityType either application (0) or validator (1)
    * @param _name bytes32 name of the app
    * @param _rewardsAddress address an address for the app to receive the rewards
    * @param _sidechainAddress address the address used for using the sidechain
    */
    function updateEntity(
        PropsRewardsLib.RewardedEntityType _entityType,
        bytes32 _name,
        address _rewardsAddress,
        address _sidechainAddress
    )
        public
    {
        PropsRewardsLib.updateEntity(rewardsLibData, _entityType, _name, _rewardsAddress, _sidechainAddress);
        emit EntityUpdated(msg.sender, _entityType, _name, _rewardsAddress, _sidechainAddress);
    }

    /**
    * @dev Allows a wallet to stake props.
    * @param _amount uint256 amount to be staked
    * @param v The recovery byte of the signature
    * @param r Half of the ECDSA signature pair
    * @param s Half of the ECDSA signature pair
    * @param _applicationAddress address (optional pass 0x address)the application main address (used to setup the application)
    * @param _userId bytes32 (optional pass empty) identification of the user on the sidechain that was settled
    */
    function stake(
        uint256 _amount,
        uint8 v,
        bytes32 r,
        bytes32 s,
        address _applicationAddress,
        bytes32 _userId,
    )
        public
    {                                
        IPropsToken token = IPropsToken(tokenContract);
        token.permit(msg.sender, address(this), _amount, uint(-1), v, r, s);
        token.transferFrom(msg.sender, address(this), _amount);                
        return _stake(msg.sender, _amount, _applicationAddress, _userId);
    }
    
    /**
    * @dev Internal stake call to be used by stake or settle
    * @param _to address where to send the props to   
    * @param _amount uint256 amount to be staked    
    * @param _applicationAddress address the application main address (used to setup the application)
    * @param _userId bytes32 identification of the user on the sidechain that was settled    
    */
    function _stake(
        address _to,
        uint256 _amount,
        address _applicationAddress,
        bytes32 _userId                        
    )
        internal
    {        
        
        uint256 amountToStake = _amount;
        // if there's currently anything staked need to collect interest and add to staking principal
        if (balanceOf(_to) > 0) {
            uint256 interestGained = _calculateInterest(_to);
            amountToStake = amountToStake.add(interestGained);
            // also mint actual props to this contract for the interest given
            IPropsToken token = IPropsToken(tokenContract);
            token.mint(address(this), interestGained);
        }
        // mint sProps tokens (they were already transferred)
        _mint(_to, amountToStake);
        stakingMap[_to].stakeRewardsDay = rewardsDay;        
        stakingMap[_to].interestRate = getParameter(PropsRewardsLib.ParameterName.StakingInterestRate, rewardsDay);        
        emit Stake(_to, rewardsDay, amountToStake, stakingMap[_to].interestRate);
    }

    /**
    * @dev Allows a user to unstake props.
    * @param _amount uint256 amount to unstake
    */
    function unstake(
        uint256 _amount
    )
        public
    {
        uint256 principal = balanceOf(msg.sender);
        require(
            principal >= _amount,
            "Cannot unstake more than what was staked"
        );
        uint256 rewardsDay = PropsRewardsLib._currentRewardsDay(rewardsLibData);
        uint256 daysStaked = rewardsDay.sub(stakingMap[msg.sender].stakeRewardsDay);
        //Daily Compound Interest = [Start Amount * (1 + (Interest Rate / 365)) ^ (n * 365)] – Start Amount
        uint256 interestGained = principal.mul(
            (1 + stakingMap[msg.sender].interestRate.div(1e16).div(365))**(daysStaked*365)
        ).sub(principal);
        //Data for withdraw
        stakingMap[msg.sender].unstakeRewardsDay = rewardsDay;
        stakingMap[msg.sender].amount = stakingMap[msg.sender].amount.add(_amount);
        stakingMap[msg.sender].interestOwed = stakingMap[msg.sender].interestOwed.add(interestGained);
        _burn(msg.sender, _amount);

        emit Unstake(msg.sender, rewardsDay, _amount, interestGained);
    }

    /**
    * @dev Allows a user to unstake props.
    */
    function withdraw()
        public
    {
        require(
            stakingMap[msg.sender].amount > 0,
            "Cannot withdraw nothing to withdraw"
        );
        uint256 rewardsDay = PropsRewardsLib._currentRewardsDay(rewardsLibData);
        require(
            rewardsDay.sub(stakingMap[msg.sender].unstakeRewardsDay) > getParameter(PropsRewardsLib.ParameterName.UnstakingCooldownPeriodDays, rewardsDay),
            "Cannot withdraw before cooldown period is over"
        );
        IPropsToken token = IPropsToken(tokenContract);
        token.mint(address(this), stakingMap[msg.sender].interestOwed);
        token.transfer(msg.sender, stakingMap[msg.sender].amount.add(stakingMap[msg.sender].interestOwed));
        stakingMap[msg.sender].amount = 0;
        stakingMap[msg.sender].interestOwed = 0;

        emit Withdraw(msg.sender, rewardsDay, stakingMap[msg.sender].amount, stakingMap[msg.sender].interestOwed);
    }

    /**
    * @dev Allows an application to settle sidechain props. Should be called from an application rewards address
    * @param _applicationAddress address the application main address (used to setup the application)
    * @param _userId bytes32 identification of the user on the sidechain that was settled
    * @param _to address where to send the props to
    * @param _amount uint256 the address used for using the sidechain
    * @param _stake bool if true the amount will be immeidatly staked and allocated to the application user
    * @param v The recovery byte of the signature
    * @param r Half of the ECDSA signature pair
    * @param s Half of the ECDSA signature pair
    */
    function settle(
        address _applicationAddress,
        bytes32 _userId,
        address _to,
        uint256 _amount,
        bool    _stake,
        uint8 v,
        bytes32 r,
        bytes32 s
    )
        public
    {
        require(
            rewardsLibData.applications[_applicationAddress].rewardsAddress == msg.sender,
            "settle may only be called by an application"
        );
        //TODO: change this function to use the tokenContract and use permit and transferFrom
        IPropsToken token = IPropsToken(tokenContract);
        if (!_stake) {
            token.permit(_applicationAddress, _to, _amount, uint(-1), v, r, s);
            token.transferFrom(_applicationAddress, _to, _amount);
        } else {            
            token.permit(_applicationAddress, address(this), _amount, uint(-1), v, r, s);
            token.transferFrom(_applicationAddress, address(this), _amount);            
            return _stake(_to, _amount, _applicationAddress, _userId);
        }
        emit Settlement(_applicationAddress, _userId, _to, _amount, msg.sender);
    }

/**
    * @dev Internal stake call to be used by stake or settle
    * @param _wallet address where to send the props to    
    * @return uint256 The gained interest
    */
    function _calculateInterest(
        address _wallet,        
    )
        internal
        returns(uint256)
    {
        uint256 rewardsDay = PropsRewardsLib._currentRewardsDay(rewardsLibData);
        uint256 daysStaked = rewardsDay.sub(stakingMap[_wallet].stakeRewardsDay);
        //Daily Compound Interest = [Start Amount * (1 + (Interest Rate / 365)) ^ (n * 365)] – Start Amount
        uint256 interestGained = principal.mul(
            (1 + stakingMap[_wallet].interestRate.div(1e16).div(365))**(daysStaked*365)
        ).sub(principal);
        return interestGained;
    }

    /**
     * @dev Delegate votes from `msg.sender` to `delegatee`
     * @param delegatee The address to delegate votes to
     */
    function delegate(address delegatee) public {
        return _delegate(msg.sender, delegatee);
    }

    /**
     * @dev Delegates votes from signatory to `delegatee`
     * @param delegatee The address to delegate votes to
     * @param nonce The contract state required to match the signature
     * @param expiry The time at which to expire the signature
     * @param v The recovery byte of the signature
     * @param r Half of the ECDSA signature pair
     * @param s Half of the ECDSA signature pair
     */
    function delegateBySig(address delegatee, uint nonce, uint expiry, uint8 v, bytes32 r, bytes32 s) public {
        bytes32 domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes("sPROPS")), getChainId(), address(this)));
        bytes32 structHash = keccak256(abi.encode(DELEGATION_TYPEHASH, delegatee, nonce, expiry));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        address signatory = ecrecover(digest, v, r, s);
        require(signatory != address(0), "delegateBySig: invalid signature");
        require(nonce == nonces[signatory]++, "delegateBySig: invalid nonce");
        require(block.timestamp <= expiry, "delegateBySig: signature expired");
        return _delegate(signatory, delegatee);
    }

    /**
     * @dev Gets the current votes balance for `account`
     * @param account The address to get votes balance
     * @return The number of current votes for `account`
     */
    function getCurrentVotes(address account) external view returns (uint256) {
        uint32 nCheckpoints = numCheckpoints[account];
        return nCheckpoints > 0 ? checkpoints[account][nCheckpoints - 1].votes : 0;
    }

    /**
     * @dev Determine the prior number of votes for an account as of a block number
     * @dev Block number must be a finalized block or else this function will revert to prevent misinformation.
     * @param account The address of the account to check
     * @param blockNumber The block number to get the vote balance at
     * @return The number of votes the account had as of the given block
     */
    function getPriorVotes(address account, uint blockNumber) public view returns (uint256) {
        require(blockNumber < block.number, "getPriorVotes: not yet determined");

        uint32 nCheckpoints = numCheckpoints[account];
        if (nCheckpoints == 0) {
            return 0;
        }

        // First check most recent balance
        if (checkpoints[account][nCheckpoints - 1].fromBlock <= blockNumber) {
            return checkpoints[account][nCheckpoints - 1].votes;
        }

        // Next check implicit zero balance
        if (checkpoints[account][0].fromBlock > blockNumber) {
            return 0;
        }

        uint32 lower = 0;
        uint32 upper = nCheckpoints - 1;
        while (upper > lower) {
            uint32 center = upper - (upper - lower) / 2; // ceil, avoiding overflow
            Checkpoint memory cp = checkpoints[account][center];
            if (cp.fromBlock == blockNumber) {
                return cp.votes;
            } else if (cp.fromBlock < blockNumber) {
                lower = center;
            } else {
                upper = center - 1;
            }
        }
        return checkpoints[account][lower].votes;
    }

    function _delegate(address delegator, address delegatee) internal {
        address currentDelegate = delegates[delegator];
        uint256 delegatorBalance = balanceOf(delegator);
        delegates[delegator] = delegatee;

        emit DelegateChanged(delegator, currentDelegate, delegatee);

        _moveDelegates(currentDelegate, delegatee, delegatorBalance);
    }

function _moveDelegates(address srcRep, address dstRep, uint256 amount) internal {
        if (srcRep != dstRep && amount > 0) {
            if (srcRep != address(0)) {
                uint32 srcRepNum = numCheckpoints[srcRep];
                uint256 srcRepOld = srcRepNum > 0 ? checkpoints[srcRep][srcRepNum - 1].votes : 0;
                uint256 srcRepNew = srcRepOld.sub(amount);
                _writeCheckpoint(srcRep, srcRepNum, srcRepOld, srcRepNew);
            }

            if (dstRep != address(0)) {
                uint32 dstRepNum = numCheckpoints[dstRep];
                uint256 dstRepOld = dstRepNum > 0 ? checkpoints[dstRep][dstRepNum - 1].votes : 0;
                uint256 dstRepNew = dstRepOld.add(amount);
                _writeCheckpoint(dstRep, dstRepNum, dstRepOld, dstRepNew);
            }
        }
    }

    function _writeCheckpoint(address delegatee, uint32 nCheckpoints, uint256 oldVotes, uint256 newVotes) internal {
      uint32 blockNumber = safe32(block.number, "_writeCheckpoint: block number exceeds 32 bits");

      if (nCheckpoints > 0 && checkpoints[delegatee][nCheckpoints - 1].fromBlock == blockNumber) {
          checkpoints[delegatee][nCheckpoints - 1].votes = newVotes;
      } else {
          checkpoints[delegatee][nCheckpoints] = Checkpoint(blockNumber, newVotes);
          numCheckpoints[delegatee] = nCheckpoints + 1;
      }

      emit DelegateVotesChanged(delegatee, oldVotes, newVotes);
    }

    function safe32(uint n, string memory errorMessage) internal pure returns (uint32) {
        require(n < 2**32, errorMessage);
        return uint32(n);
    }

    function getChainId() internal pure returns (uint) {
        uint256 chainId;
        assembly { chainId := chainid() }
        return chainId;
    }

    /**
    * @dev Mint rewards for validators
    * @param _rewardsDay uint256 the rewards day
    * @param _rewardsHash bytes32 hash of the rewards data
    * @param _amount uint256 amount each validator should get
    */
    function _mintDailyRewardsForValidators(uint256 _rewardsDay, bytes32 _rewardsHash, uint256 _amount)
        internal
    {
        IPropsToken token = IPropsToken(tokenContract);
        uint256 validatorsCount = rewardsLibData.dailyRewards.submissions[_rewardsHash].validatorsList.length;
        for (uint256 i = 0; i < validatorsCount; i++) {
            token.mint(
                rewardsLibData.validators[rewardsLibData.dailyRewards.submissions[_rewardsHash].validatorsList[i]].rewardsAddress,
                _amount
            );
        }
        PropsRewardsLib._resetDailyRewards(rewardsLibData, _rewardsHash);
        emit DailyRewardsValidatorsMinted(
            _rewardsDay,
            _rewardsHash,
            validatorsCount,
            (_amount * validatorsCount)
        );
    }

    /**
    * @dev Mint rewards for apps
    * @param _rewardsDay uint256 the rewards day
    * @param _rewardsHash bytes32 hash of the rewards data
    * @param _applications address[] array of application addresses getting the daily reward
    * @param _amounts uint256[] array of amounts each app should get
    * @param _sum uint256 the sum of all application rewards given
    */
    function _mintDailyRewardsForApps(
        uint256 _rewardsDay,
        bytes32 _rewardsHash,
        address[] memory _applications,
        uint256[] memory _amounts,
        uint256 _sum
    )
        internal
    {
        IPropsToken token = IPropsToken(tokenContract);
        for (uint256 i = 0; i < _applications.length; i++) {
            token.mint(rewardsLibData.applications[_applications[i]].rewardsAddress, _amounts[i]);
        }
        emit DailyRewardsApplicationsMinted(_rewardsDay, _rewardsHash, _applications.length, _sum);
    }

}