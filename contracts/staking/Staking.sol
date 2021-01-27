// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.7.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/MathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "../interfaces/IStaking.sol";

/**
 * @title  Staking
 * @author Forked from: Synthetix
 *         Changes by: Props
 * @notice Reward stakers of staking tokens with reward tokens, on a pro-rata basis.
 * @dev    In order to allow for passive reward accrual, it uses an ever-increasing
 *         `rewardsPerTokenStored` variable that gets updated on every write action
 *         to the contract.
 *         Changes to the original Synthetix contract:
 *         - the contract is upgradeable
 *         - the contract is ownable and only the owner is able to perform state-changing
 *           actions (this means individual users cannot directly interact with instances
 *           of this contract)
 *         - the rewards get distributed in a perpetual fashion, closely following a
 *           diminishing returns curve (at most once per day, the `rewardRate`
 *           and `periodFinish` variables get updated via the `updateRewardRate` modifier)
 *         - the `rewardsDuration` variable gets calculated from the `dailyRewardsEmission`
 *           parameter on initialization, which specifies the percentage of the remaining
 *           rewards pool that should get distributed each day
 *         - the staked and withdrawn amounts are implicit (the contract trusts its owner
 *           to provide correct values), no staking tokens are transferred to or from this
 *           contract
 *         - on claiming, rewards are tranferred to the owner of the contract instead of
 *           the actual recipient, the owner being responsible for handling the rewards as
 *           it sees fit
 */
contract Staking is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable, IStaking {
    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // The address responsible for distributing the rewards
    address public rewardsDistribution;

    address public rewardsToken;
    address public stakingToken;

    // The finish time of the current rewards period
    uint256 public periodFinish;
    // The currently active reward rate
    uint256 public rewardRate;
    // The duration of the rewards period
    uint256 public rewardsDuration;
    // Last time any user took any action (stake / unstake / claim / distribute)
    uint256 public lastUpdateTime;
    // Ever-increasing reward per token rate that allows for passive reward accrual
    uint256 public rewardPerTokenStored;
    // Last time the reward rate got updated
    uint256 public lastRewardRateUpdate;

    // Mapping of the last `rewardPerTokenStored` rate of each user
    mapping(address => uint256) public userRewardPerTokenPaid;
    // Mapping of the accrued rewards of each user
    mapping(address => uint256) public rewards;

    // Total amount of tokens staked
    uint256 private _totalSupply;
    // Mapping of the staked balances of each user
    mapping(address => uint256) private _balances;

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);

    /***************************************
                   INITIALIZER
    ****************************************/

    /**
     * @dev Initializer.
     * @param _owner The owner of the contract
     * @param _rewardsDistribution The designated rewards distribution address
     * @param _rewardsToken The token rewards are denominated in
     * @param _stakingToken The token stakes are denominated in
     * @param _dailyRewardEmission The percentage of the remaining rewards pool to get distributed each day
     */
    function initialize(
        address _owner,
        address _rewardsDistribution,
        address _rewardsToken,
        address _stakingToken,
        uint256 _dailyRewardEmission
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

        if (_owner != msg.sender) {
            transferOwnership(_owner);
        }

        rewardsDistribution = _rewardsDistribution;

        rewardsToken = _rewardsToken;
        stakingToken = _stakingToken;

        rewardsDuration = uint256(1e18).div(_dailyRewardEmission).mul(1 days);
    }

    /***************************************
                     GETTERS
    ****************************************/

    /**
     * @dev Gets the total staked amount.
     */
    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    /**
     * @dev Gets the staked balance of an account.
     */
    function balanceOf(address _account) external view override returns (uint256) {
        return _balances[_account];
    }

    /**
     * @dev Gets the last applicable timestamp for the current rewards period.
     */
    function lastTimeRewardApplicable() public view returns (uint256) {
        return MathUpgradeable.min(block.timestamp, periodFinish);
    }

    /**
     * @dev Calculates the amount of rewards per token that are to be distributed
     *      since the last update and sums with the stored rate to give the new
     *      cumulative reward per token rate.
     */
    function rewardPerToken() public view returns (uint256) {
        if (_totalSupply == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored.add(
                lastTimeRewardApplicable().sub(lastUpdateTime).mul(rewardRate).mul(1e18).div(
                    _totalSupply
                )
            );
    }

    /**
     * @dev Gets the amount of unclaimed rewards a user has accrued.
     */
    function earned(address _account) public view override returns (uint256) {
        return
            _balances[_account]
                .mul(rewardPerToken().sub(userRewardPerTokenPaid[_account]))
                .div(1e18)
                .add(rewards[_account]);
    }

    /***************************************
                     ACTIONS
    ****************************************/

    /**
     * @dev Stake a given amount for the given account.
     * @param _account The address of the account to stake for
     * @param _amount The amount to stake
     */
    function stake(address _account, uint256 _amount)
        external
        override
        onlyOwner
        nonReentrant
        updateReward(_account)
        updateRewardRate
    {
        require(_amount > 0, "Cannot stake 0");
        _totalSupply = _totalSupply.add(_amount);
        _balances[_account] = _balances[_account].add(_amount);
        emit Staked(_account, _amount);
    }

    /**
     * @dev Withdraw a given previously staked amount for the given account.
     * @param _account The address of the account to withdraw for
     * @param _amount The amount to withdraw
     */
    function withdraw(address _account, uint256 _amount)
        external
        override
        onlyOwner
        nonReentrant
        updateReward(_account)
    {
        require(_amount > 0, "Cannot withdraw 0");
        _totalSupply = _totalSupply.sub(_amount);
        _balances[_account] = _balances[_account].sub(_amount);
        emit Withdrawn(_account, _amount);
    }

    /**
     * @dev Claim outstanding rewards for the given account.
     * @param _account The address of the account to claim rewards for
     */
    function claimReward(address _account)
        external
        override
        onlyOwner
        nonReentrant
        updateReward(_account)
    {
        uint256 reward = rewards[_account];
        if (reward > 0) {
            rewards[_account] = 0;
            IERC20Upgradeable(rewardsToken).safeTransfer(owner(), reward);
            emit RewardPaid(_account, reward);
        }
    }

    /**
     * @dev Notifies the contract that new rewards have been added and updates any
     *      parameters to take the new rewards into account.
     * @param _reward The amount of rewards that are getting distributed
     */
    function notifyRewardAmount(uint256 _reward)
        external
        override
        onlyRewardsDistribution
        updateReward(address(0))
    {
        if (block.timestamp >= periodFinish) {
            // If the previous rewards period is over, simply reset `rewardRate`
            rewardRate = _reward.div(rewardsDuration);
        } else {
            // Otherwise, top-up the remaining amount from the previous rewards period
            uint256 remaining = periodFinish.sub(block.timestamp);
            uint256 leftover = remaining.mul(rewardRate);
            rewardRate = _reward.add(leftover).div(rewardsDuration);
        }

        // Ensure the provided reward amount is not more than the balance in the contract.
        // This keeps the reward rate in the right range, preventing overflows due to
        // very high values of rewardRate in the earned and rewardsPerToken functions;
        // Reward + leftover must be less than 2^256 / 10^18 to avoid overflow.
        uint256 balance = IERC20Upgradeable(rewardsToken).balanceOf(address(this));
        require(rewardRate <= balance.div(rewardsDuration), "Provided reward too high");

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp.add(rewardsDuration);
        emit RewardAdded(_reward);
    }

    /**
     * @dev Change the reward distribution address.
     */
    function setRewardsDistribution(address _account) external override onlyRewardsDistribution {
        rewardsDistribution = _account;
    }

    /***************************************
                     HELPERS
    ****************************************/

    /**
     * @dev Update reward parameters, before executing the corresponding function.
     */
    modifier updateReward(address _account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (_account != address(0)) {
            rewards[_account] = earned(_account);
            userRewardPerTokenPaid[_account] = rewardPerTokenStored;
        }
        _;
    }

    /**
     * @dev Update the reward rate and rewards period finish time, mimicking a perpetual distribution.
     */
    modifier updateRewardRate() {
        _;
        if (lastRewardRateUpdate == 0) {
            // First update has no effect
            lastRewardRateUpdate = block.timestamp;
        } else if (
            block.timestamp < periodFinish && block.timestamp.sub(lastRewardRateUpdate) >= 1 days
        ) {
            // At most once per day, further updates change the `rewardRate` and `periodFinish` variables
            uint256 remaining = periodFinish.sub(block.timestamp);
            uint256 leftover = remaining.mul(rewardRate);
            rewardRate = leftover.div(rewardsDuration);
            periodFinish = block.timestamp.add(rewardsDuration);
            lastRewardRateUpdate = block.timestamp;
        }
    }

    /**
     * @dev Only allow the `rewardsDistribution` address to call the corresponding function.
     */
    modifier onlyRewardsDistribution() {
        require(
            msg.sender == rewardsDistribution,
            "Caller is not the designated rewards distribution address"
        );
        _;
    }
}
