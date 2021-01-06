## `AppToken`

Each app in the Props protocol gets an associated ERC20-compatible AppToken. AppTokens are mintable according to a known inflation rate. On every mint, a fixed percentage of the newly minted tokens (5%) goes to the Props treasury address, while the rest goes to the app's owner.

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
