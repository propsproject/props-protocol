import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

import { HardhatUserConfig } from "hardhat/types";

import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-etherscan";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-gas-reporter";
import "hardhat-typechain";
import "solidity-coverage";

import accounts from "./test-accounts";

const MNEMONIC = "hip mention twenty random stairs nasty pistol essay giraffe season shuffle ring";

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  solidity: {
    compilers: [
      {
        version: "0.6.8",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
        },
      },
    ],
  },
  networks: {
    hardhat: { accounts },
    ethereumLocal: {
      url: "http://localhost:8545",
      accounts: {
        mnemonic: MNEMONIC,
      },
    },
    ethereumGoerli: {
      url: `https://goerli.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
      accounts: {
        mnemonic: MNEMONIC,
      },
    },
    arbitrumLocal: {
      url: "http://localhost:8547",
      accounts: {
        mnemonic: MNEMONIC,
      },
    },
    arbitrumKovan: {
      url: "https://kovan3.arbitrum.io/rpc",
      accounts: {
        mnemonic: MNEMONIC,
      },
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS ? true : false,
  },
};

export default config;
