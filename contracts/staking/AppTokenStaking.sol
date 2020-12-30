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
 * @dev The AppTokenStaking contract is responsible for allowing users
 *   to stake Props while earning rewards in their app token of choice.
 *   Each app token has a corresponding staking contract. Users are not
 *   allowed to stake/unstake/claim rewards by directly interacting with
 *   instances of this contract. Instead, the StakingManager should be
 *   the owner of all app token staking contract instances and thus all
 *   actions should be proxied by it.
 */
contract AppTokenStaking is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    IStaking
{
    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @dev The address responsible for distributing the staking rewards
    address public rewardsDistribution;

    /// @dev The token the staking rewards are denominated in (will be an instance of the AppToken contract)
    address public rewardsToken;
    /// @dev The token the stakes are denominated in (will be the Props token)
    address public stakingToken;

    uint256 public periodFinish;
    uint256 public rewardRate;
    uint256 public rewardsDuration;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public lastStakeTime;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

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
        address _stakingToken,
        uint256 _dailyRewardsEmission
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

        // Set the proper owner
        if (_owner != msg.sender) {
            transferOwnership(_owner);
        }

        rewardsDistribution = _rewardsDistribution;
        rewardsToken = _rewardsToken;
        stakingToken = _stakingToken;
        rewardsDuration = uint256(1e18).div(_dailyRewardsEmission).mul(1 days);
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
        IERC20Upgradeable(stakingToken).safeTransferFrom(owner(), address(this), amount);
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
        IERC20Upgradeable(stakingToken).safeTransfer(owner(), amount);
        emit Withdrawn(account, amount);
    }

    function getReward(address account)
        external
        override
        onlyOwner
        nonReentrant
        updateReward(account)
    {
        uint256 reward = rewards[account];
        if (reward > 0) {
            rewards[account] = 0;
            IERC20Upgradeable(rewardsToken).safeTransfer(account, reward);
            emit RewardPaid(account, reward);
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
        uint256 balance = IERC20Upgradeable(rewardsToken).balanceOf(address(this));
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
