import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

import { HardhatUserConfig } from "hardhat/types";

import "@eth-optimism/plugins/hardhat/compiler";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-etherscan";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-gas-reporter";
import "hardhat-typechain";
import "solidity-coverage";

import accounts from "./test-accounts";

const MNEMONIC = "hip mention twenty random stairs nasty pistol essay giraffe season shuffle ring";
const OPTIMISM_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

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
    local: {
      url: "http://localhost:8545",
      accounts: {
        mnemonic: MNEMONIC,
      },
    },
    ropsten: {
      url: `https://ropsten.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
      accounts: {
        mnemonic: MNEMONIC,
      },
    },
    optimism: {
      url: "http://localhost:8545",
      accounts: {
        mnemonic: OPTIMISM_MNEMONIC,
      },
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS ? true : false,
  },
};

export default config;
