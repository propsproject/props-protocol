## `AppPoints`

Each app in the Props protocol gets an associated ERC20-compatible AppPoints token. AppPoints tokens are mintable according to a known inflation rate. On every mint, a fixed percentage of the newly minted tokens (5%) goes to the Props treasury address, while the rest goes to the app's owner. Initially, AppPoints tokens are non-transferrable, only certain whitelisted addresses being able to perform transfers.

Every AppPoints token associated to an app comes in two variants, one residing on L1 and another on L2. Most non-ERC20 functionality (eg. inflation rate, app info IPFS hash), except for pausing and transfers whitelisting, is only available on the L1 variants of the AppPoints tokens. These two variants are to be mapped together via an L1 - L2 bridge, where L1 AppPoints tokens are getting locked on L1 and a corresponding amount of L2 AppPoints tokens are getting minted on L2. Since pausing and whitelisting for transfers is available on both L1 and L2, this state has to be kept in sync across the two layers in order to have consistency (although it is definitely possible to only whitelist a certain address on a single layer while having it blacklisted on the other one).

Contracts of interest:

- `AppPointsCommon`: includes common AppPoints token functionality shared by both the L1 and L2 variants
- `AppPointsL1`: includes L1-specific AppPoints token functionality
- `AppPointsL2`: includes L2-specific AppPoints token functionality

### Architecture

The following functions are only available on the L1 variant of AppPoints tokens:

##### Mint

Mint new AppPoints tokens according to the set inflation rate. The number of new tokens that will get minted is equal to `(currentTime - lastMintTime) * inflationRate`. As mentioned, a fixed percentage of the newly minted tokens goes to the Props treasury address while the rest goes to the app's owner.

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

The following functions are available on both the L1 and L2 variants of AppPoints tokens:

##### Pause

Pause any transfer. However, the app's owner is able to overcome this by allowing transfers from certain whitelisted addresses.

```solidity
function pause()
```

##### Unpause

Unpause the contract. This will re-enable transfers.

```solidity
function unpause()
```

##### Whitelist for transfers

Whitelist an address for performing transfers. The whitelist is only relevant when transfers are paused.

```solidity
function whitelistForTransfers(address _account)
```

##### Blacklist for transfers

Blacklist an from performing transfers. The blacklist is only active when the transfers are paused.

```solidity
function blacklistForTransfers(address _account)
```
