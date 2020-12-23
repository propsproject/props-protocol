// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/MathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "../interfaces/IStaking.sol";

/**
 * @dev The SPropsUserStaking contract is used for staking sProps and earning
 *   rProps rewards. This particular contract is used by the StakingManager
 *   to stake individual users' sProps in order to earn them Props rewards.
 *   The staked amounts are implicit (that is, no staking token is actually
 *   transferred to this contract) and fully handled by the contract's owner
 *   (which is the StakingManager). The rewards are distributed in a perpetual
 *   fashion, with more rewards getting distributed at the beginning of the
 *   rewards period and then the rate is slowly decreasing. Also, the staking
 *   rewards are escrowed and only progressively unlocked over time based on
 *   the lock duration.
 */
contract SPropsUserStaking is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    IStaking
{
    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @dev The address responsible for distributing the staking rewards
    address public rewardsDistribution;

    /// @dev The token the staking rewards are denominated in (this is the rProps token)
    IERC20Upgradeable public rewardsToken;

    uint256 public periodFinish;
    uint256 public rewardRate;
    uint256 public rewardsDuration;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    /// @dev The most recent timestamp when a stake occured
    uint256 public lastStakeTime;
    /// @dev The lock duration for the staking rewards
    uint256 public rewardsLockDuration;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    /// @dev Keeps track of the staking enter time
    mapping(address => uint256) private _enterTime;
    /// @dev Keeps track of the staking exit time (staking exit = unstake everything)
    mapping(address => uint256) private _exitTime;
    /// @dev Keeps track of the amount of rewards claimed so far
    mapping(address => uint256) private _claimedRewards;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);

    function initialize(
        address _owner,
        address _rewardsDistribution,
        address _rewardsToken,
        uint256 _dailyRewardsEmission,
        uint256 _rewardsLockDuration
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

        // Set the proper owner
        if (_owner != msg.sender) {
            super.transferOwnership(_owner);
        }

        rewardsDistribution = _rewardsDistribution;
        rewardsToken = IERC20Upgradeable(_rewardsToken);
        rewardsDuration = uint256(1e18).div(_dailyRewardsEmission).mul(1 days);
        rewardsLockDuration = _rewardsLockDuration;
    }

    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view override returns (uint256) {
        return _balances[account];
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return MathUpgradeable.min(block.timestamp, periodFinish);
    }

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

    function earned(address account) public view override returns (uint256) {
        return
            _balances[account]
                .mul(rewardPerToken().sub(userRewardPerTokenPaid[account]))
                .div(1e18)
                .add(rewards[account]);
    }

    function getRewardForDuration() external view override returns (uint256) {
        return rewardRate.mul(rewardsDuration);
    }

    function stake(address account, uint256 amount)
        external
        override
        onlyOwner
        nonReentrant
        updateReward(account)
        updateRewardRate
    {
        require(amount > 0, "Cannot stake 0");

        _totalSupply = _totalSupply.add(amount);
        _balances[account] = _balances[account].add(amount);

        if (_enterTime[account] == 0 || _exitTime[account] != 0) {
            _enterTime[account] = block.timestamp;
            _exitTime[account] = 0;
        }

        emit Staked(account, amount);
    }

    function withdraw(address account, uint256 amount)
        external
        override
        onlyOwner
        nonReentrant
        updateReward(account)
    {
        require(amount > 0, "Cannot withdraw 0");

        _totalSupply = _totalSupply.sub(amount);
        _balances[account] = _balances[account].sub(amount);

        if (_balances[account] == 0) {
            _exitTime[account] = block.timestamp;
        }

        emit Withdrawn(account, amount);
    }

    function getReward(address account)
        external
        override
        onlyOwner
        nonReentrant
        updateReward(account)
    {
        if (
            _enterTime[account] != 0 &&
            block.timestamp.sub(_enterTime[account]) > rewardsLockDuration
        ) {
            uint256 stakeDuration;
            if (_exitTime[account] != 0) {
                stakeDuration = _exitTime[account].sub(_enterTime[account]);
            } else {
                stakeDuration = block.timestamp.sub(_enterTime[account]);
            }

            uint256 availableRewards =
                MathUpgradeable
                    .min(
                    stakeDuration,
                    block.timestamp.sub(_enterTime[account].add(rewardsLockDuration))
                )
                    .div(stakeDuration)
                    .mul(rewards[account]);

            uint256 reward = availableRewards.sub(_claimedRewards[account]);
            _claimedRewards[account] = _claimedRewards[account].add(reward);

            if (reward > 0) {
                // TODO Transfer and swap rProps
                rewardsToken.transfer(account, reward);
                emit RewardPaid(account, reward);
            }
        }
    }

    function notifyRewardAmount(uint256 reward)
        external
        override
        onlyRewardsDistribution
        updateReward(address(0))
    {
        if (block.timestamp >= periodFinish) {
            rewardRate = reward.div(rewardsDuration);
        } else {
            uint256 remaining = periodFinish.sub(block.timestamp);
            uint256 leftover = remaining.mul(rewardRate);
            rewardRate = reward.add(leftover).div(rewardsDuration);
        }

        // Ensure the provided reward amount is not more than the balance in the contract.
        // This keeps the reward rate in the right range, preventing overflows due to
        // very high values of rewardRate in the earned and rewardsPerToken functions;
        // Reward + leftover must be less than 2^256 / 10^18 to avoid overflow.
        uint256 balance = rewardsToken.balanceOf(address(this));
        require(rewardRate <= balance.div(rewardsDuration), "Provided reward too high");

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp.add(rewardsDuration);
        emit RewardAdded(reward);
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    modifier updateRewardRate() {
        _;
        if (lastStakeTime == 0) {
            lastStakeTime = block.timestamp;
        } else if (block.timestamp < periodFinish && block.timestamp.sub(lastStakeTime) >= 1 days) {
            uint256 remaining = periodFinish.sub(block.timestamp);
            uint256 leftover = remaining.mul(rewardRate);
            rewardRate = leftover.div(rewardsDuration);
            periodFinish = block.timestamp.add(rewardsDuration);
            lastStakeTime = block.timestamp;
        }
    }

    modifier onlyRewardsDistribution() {
        require(msg.sender == rewardsDistribution, "Caller is not RewardsDistribution contract");
        _;
    }
}
