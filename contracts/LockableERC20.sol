// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./interfaces/ILockableERC20.sol";

contract LockableERC20 is ERC20, ILockableERC20 {
    using SafeMath for uint256;

    /// @notice Lock duration
    uint256 public constant lockDuration = 30 days;

    /// @notice A record of each accounts total locked tokens
    mapping(address => uint256) public totalLocked;

    /// @notice A record of each accounts individual lock times on tokens
    mapping(address => uint256[]) public lockTimes;

    /// @notice A record of each accounts individual locks on tokens
    mapping(address => mapping(uint256 => uint256)) public locks;

    /// @notice An event thats emitted when an account receives new locked tokens
    event Locked(address indexed account, uint256 amount, uint256 lockTime, uint256 unlockTime);

    /// @notice An event thats emitted when an account unlocks previously locked tokens
    event Unlocked(address indexed account, uint256 amount, uint256 lockTime);

    constructor(string memory name, string memory symbol) public ERC20(name, symbol) {}

    /**
     * @notice Get the total number of tokens held by the `account` (locked + transferable)
     * @param account The address of the account to get the total balance of
     * @return The total number of tokens held
     */
    function totalBalanceOf(address account) external view override returns (uint256) {
        return balanceOf(account).add(totalLocked[account]);
    }

    /**
     * @notice Transfers and locks `amount` tokens from `msg.sender` to `dst`
     * @param dst The address of the destination account
     * @param amount The number of tokens to transfer
     * @return Whether or not the transfer succeeded
     */
    function transferWithLock(address dst, uint256 amount) external override returns (bool) {
        require(locks[dst][now] == 0, "LockableERC20::transferWithLock: tokens already locked");
        require(amount != 0, "LockableERC20::transferWithLock: amount cannot be 0");

        locks[dst][now] = amount;
        totalLocked[dst] = totalLocked[dst].add(amount);
        lockTimes[dst].push(now);

        transfer(address(this), amount);

        emit Locked(dst, amount, now, now.add(lockDuration));
        return true;
    }

    /**
     * @notice Unlocks the requested locked tokens of the `account`
     * @param account The address of the locked tokens owner
     * @param lockTimesToUnlock Array of lock times requested to be unlocked
     */
    function unlock(address account, uint256[] calldata lockTimesToUnlock) external override {
        uint256 unlockedTokens = 0;
        for (uint256 i = 0; i < lockTimesToUnlock.length; i++) {
            uint256 lockedTokens = locks[account][lockTimesToUnlock[i]];
            if (lockedTokens > 0 && now.sub(lockTimesToUnlock[i]) > lockDuration) {
                delete locks[account][lockTimesToUnlock[i]];
                unlockedTokens = unlockedTokens.add(lockedTokens);
                totalLocked[account] = totalLocked[account].sub(lockedTokens);
                emit Unlocked(account, lockedTokens, lockTimesToUnlock[i]);
            }
        }

        if (unlockedTokens > 0) {
            this.transfer(account, unlockedTokens);
        }
    }
}
