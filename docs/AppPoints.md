## `AppPoints`

Each app in the Props protocol gets an associated ERC20-compatible AppPoints token. AppPoints tokens are mintable according to a known inflation rate. On every mint, a fixed percentage of the newly minted tokens (5%) goes to the Props treasury address, while the rest goes to the app's owner. Initially, AppPoints tokens are non-transferrable, only certain whitelisted addresses being able to perform transfers.

Every AppPoints token associated to an app comes in two variants, one residing on layer 1 and another on layer 2. Most non-ERC20 functionality (eg. inflation rate, app info IPFS hash), except for pausing and transfers whitelisting, is only available on the layer 1 variant of the AppPoints tokens. These two variants are to be mapped together via an L1 - L2 bridge, where L1 AppPoints tokens are getting locked on L1 and a corresponding amount of L2 AppPoints tokens are getting minted on L2. Since pausing and whitelisting for transfers is available on both L1 and L2, the whitelisting information has to be kept in sync across the two layers in order to have consistency (although it is possible to only whitelist a certain address on a single layer while having it blacklisted on the other one).

### Architecture

##### Mint

Mint new AppPoints tokens according to the set inflation rate. The number of new tokens that will get minted is equal to `(block.timestamp - lastMintTime) * inflationRate`. As mentioned, a fixed percentage of the newly minted tokens goes to the Props treasury address while the rest goes to the app's owner.

```solidity
function mint()
```

##### Update app info

Update the IPFS hash pointing to the app's info. Each app can have optional information associated to it (eg. bio, logo). This information is to be stored on IPFS, and the IPFS hash of it should be kept on-chain.

```solidity
function changeAppInfo(bytes _appInfo)
```

##### Change inflation rate

Change the AppPoints token's inflation rate. Once changed, there is a delay before the new inflation rate goes into effect.

```solidity
function changeInflationRate(uint256 _inflationRate)
```

##### Pause

Pause any transfer. However, the app's owner is able to allow transfers from certain whitelisted addresses.

```solidity
function pause()
```

##### Unpause

Unpause the contract. This will re-enable transfers.

```solidity
function unpause()
```

##### Whitelist for transfers

Whitelist an address for performing transfers. The whitelist is only active when transfers are paused.

```solidity
function whitelistForTransfers(address _account)
```

##### Blacklist for transfers

Blacklist an from performing transfers. The blacklist is only active when the transfers are paused.

```solidity
function blacklistForTransfers(address _account)
```
