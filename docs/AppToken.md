## `AppToken`

Each app in the Props protocol gets an associated ERC20-compatible AppToken. AppTokens are mintable according to a known inflation rate. On every mint, a fixed percentage of the newly minted tokens (5%) goes to the Props treasury address, while the rest goes to the app's owner. Initially, AppTokens are non-transferrable, only certain whitelisted addresses being able to perform transfers.

### Architecture

##### Mint

Mint new AppTokens according to the set inflation rate. The number of new AppTokens that will get minted is equal to `(block.timestamp - lastMintTime) * inflationRate`. As mentioned, a fixed percentage of the newly minted tokens goes to Props while the rest goes to the app's owner.

```solidity
function mint() external onlyOwner
```

##### Change inflation rate

Change the AppToken's inflation rate. Once changed, there is a delay before the new inflation rate goes into effect.

```solidity
function changeInflationRate(uint256 _inflationRate) external onlyOwner
```

##### Pause

Pause any transfer. The AppToken's owner is able to restrict transfers to a specific set of addresses.

```solidity
function pause() public onlyOwner
```

##### Whitelist address

Whitelist an address to perform transfers. The whitelist is only active when the AppToken is paused.

```solidity
function whitelistAddress(address _account) public onlyOwner
```

##### Blacklist address

Blacklist a previously whitelisted address from performing transfers. The blacklist is only active when the AppToken is paused.

```solidity
function blacklistAddress(address _account) external onlyOwner
```
