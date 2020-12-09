// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "./interfaces/IRewardsEscrow.sol";

// Some questions:
// - should we make this ownable?
// - if yes, should we allow the owner to change the lock duration?
// - maybe only allow the owner to set a smaller lock duration

contract RewardsEscrow is IRewardsEscrow {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    /// @notice The token this escrow is associated to
    IERC20 public rewardsToken;

    /// @notice Lock duration in blocks for each rewards tranche
    uint256 public lockDuration;

    /// @notice A record of each account's total number of locked tokens
    mapping(address => uint256) public totalLocked;

    /// @notice A record of each account's individual lock blocks
    mapping(address => uint256[]) public lockBlocks;

    /// @notice A record of each account's individual locks on tokens
    mapping(address => mapping(uint256 => uint256)) public locks;

    /// @notice An event that's emitted when new rewards tranches are put in the escrow
    event Locked(address indexed account, uint256 amount, uint256 lockBlock, uint256 unlockBlock);

    /// @notice An event that's emitted when a rewards tranche gets unlocked
    event Unlocked(address indexed account, uint256 amount, uint256 lockBlock);

    constructor(address _rewardsToken, uint256 _lockDuration) public {
        rewardsToken = IERC20(_rewardsToken);
        lockDuration = _lockDuration;
    }

    /**
     * @notice Get the total number of locked tokens held by `account`
     * @param account The address of the account to get the number of locked tokens of
     * @return The total number of locked tokens held
     */
    function lockedBalanceOf(address account) external view override returns (uint256) {
        return totalLocked[account];
    }

    /**
     * @notice Locks `amount` tokens under `account`
     * @param account The address of the locked tokens owner
     * @param amount The number of tokens to lock
     * @return Whether or not the lock succeeded
     */
    function lock(address account, uint256 amount) external override returns (bool) {
        require(locks[account][block.number] == 0, "RewardsEscrow::lock: tokens already locked");
        require(amount != 0, "RewardsEscrow::lock: amount cannot be 0");

        locks[account][block.number] = amount;
        totalLocked[account] = totalLocked[account].add(amount);
        lockBlocks[account].push(block.number);

        rewardsToken.safeTransferFrom(msg.sender, address(this), amount);

        emit Locked(account, amount, block.number, block.number.add(lockDuration));
        return true;
    }

    /**
     * @notice Unlocks locked tokens of `account`
     * @param account The address of the locked tokens owner
     * @param blocksToUnlock Array of lock blocks to unlock
     */
    function unlock(address account, uint256[] calldata blocksToUnlock) external override {
        uint256 unlockedTokens = 0;
        for (uint256 i = 0; i < blocksToUnlock.length; i++) {
            uint256 lockedTokens = locks[account][blocksToUnlock[i]];
            if (lockedTokens > 0 && block.number.sub(blocksToUnlock[i]) > lockDuration) {
                delete locks[account][blocksToUnlock[i]];
                unlockedTokens = unlockedTokens.add(lockedTokens);
                totalLocked[account] = totalLocked[account].sub(lockedTokens);
                emit Unlocked(account, lockedTokens, blocksToUnlock[i]);
            }
        }

        if (unlockedTokens > 0) {
            rewardsToken.safeTransfer(account, unlockedTokens);
        }
    }
}
