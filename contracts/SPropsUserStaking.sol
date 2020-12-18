// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/MathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "./SProps.sol";

// Staking contract for individual users' sProps
contract SPropsUserStaking is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address public rewardsDistribution;

    // TODO: Change to rProps
    IERC20Upgradeable public rewardsToken;
    IERC20Upgradeable public stakingToken;

    uint256 public periodFinish;
    uint256 public rewardRate;
    uint256 public rewardsDuration;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public lastStakeTime;
    uint256 public rewardsLockDuration;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    mapping(address => uint256) private _firstStakeTime;
    mapping(address => uint256) private _exitTime;
    mapping(address => uint256) private _claimedRewards;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);

    function initialize(
        address _rewardsDistribution,
        address _rewardsToken,
        address _stakingToken,
        uint256 _dailyRewardsEmission,
        uint256 _rewardsLockDuration
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

        rewardsDistribution = _rewardsDistribution;
        rewardsToken = IERC20Upgradeable(_rewardsToken);
        stakingToken = IERC20Upgradeable(_stakingToken);
        rewardsDuration = uint256(1e18).div(_dailyRewardsEmission).mul(1 days);
        rewardsLockDuration = _rewardsLockDuration;
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
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

    function earned(address account) public view returns (uint256) {
        return
            _balances[account]
                .mul(rewardPerToken().sub(userRewardPerTokenPaid[account]))
                .div(1e18)
                .add(rewards[account]);
    }

    function getRewardForDuration() external view returns (uint256) {
        return rewardRate.mul(rewardsDuration);
    }

    function stake(address account)
        external
        onlyOwner
        nonReentrant
        updateReward(account)
        updateRewardRate
    {
        // The staked amount is the staking token (sProps) balance
        uint256 amount = stakingToken.balanceOf(account);

        require(amount > 0, "Cannot stake 0");
        // Once fully exiting staking there is no way to get back in via the same address
        require(_firstStakeTime[account] == 0, "Cannot reenter staking");

        _totalSupply = _totalSupply.add(amount);
        _balances[account] = _balances[account].add(amount);
        _firstStakeTime[account] = block.timestamp;

        emit Staked(account, amount);
    }

    function withdraw(address account, uint256 amount)
        external
        onlyOwner
        nonReentrant
        updateReward(account)
    {
        // The withdrawn amount cannot exceed the account's total balance of the staking token (sProps)
        require(amount <= stakingToken.balanceOf(account), "Withdrawn amount overflow");
        require(amount > 0, "Cannot withdraw 0");

        _totalSupply = _totalSupply.sub(amount);
        _balances[account] = _balances[account].sub(amount);
        // Check if this is a full exit from staking
        if (_balances[account] == 0) {
            _exitTime[account] = block.timestamp;
        }

        emit Withdrawn(account, amount);
    }

    function getReward(address account) external onlyOwner nonReentrant updateReward(account) {
        // Cannot earn any rewards without staking first
        require(_firstStakeTime[account] != 0, "No staking");

        if (_exitTime[account] != 0) {
            // No rewards are given if fully exiting before the maturity date
            require(
                _exitTime[account].sub(_firstStakeTime[account]) > rewardsLockDuration,
                "No rewards"
            );
        }

        // Rewards are only claimable after the maturity date
        require(block.timestamp.sub(_firstStakeTime[account]) > rewardsLockDuration, "No rewards");
        
        uint256 stakeDuration;
        if (_exitTime[account] != 0) {
            stakeDuration = _exitTime[account].sub(_firstStakeTime[account]);
        } else {
            stakeDuration = block.timestamp.sub(_firstStakeTime[account]);
        }

        uint256 availableRewards =
            MathUpgradeable
                .min(
                stakeDuration,
                block.timestamp.sub(_firstStakeTime[account].add(rewardsLockDuration))
            )
                .div(stakeDuration)
                .mul(rewards[account]);

        uint256 reward = availableRewards.sub(_claimedRewards[account]);
        _claimedRewards[account] = _claimedRewards[account].add(reward);

        if (reward > 0) {
          rewardsToken.safeTransfer(account, reward);
          // TODO Redeem rProps for Props
          emit RewardPaid(account, reward);
        }
    }

    function notifyRewardAmount(uint256 reward)
        external
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
