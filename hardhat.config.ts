import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

import { HardhatUserConfig } from "hardhat/types";

import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-etherscan";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-gas-reporter";
import "hardhat-typechain";
import "solidity-coverage";

// Use predefined accounts for testing
import testAccounts from "./test-accounts";

// Accounts for production deployments
const prodAccounts = [
  `${process.env.DEPLOYER_PRIVATE_KEY}`,
  `${process.env.CONTROLLER_PRIVATE_KEY}`,
];

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  solidity: {
    compilers: [
      {
        version: "0.7.3",
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
    hardhat: { accounts: testAccounts },
    // Testnet configs
    goerli: {
      url: `https://goerli.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
      accounts: prodAccounts,
    },
    mumbai: {
      url: "https://rpc-mumbai.matic.today",
      accounts: prodAccounts,
    },
    // Mainnet configs
    mainnet: {
      url: `https://mainnet.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
      accounts: prodAccounts,
    },
    matic: {
      url: "https://rpc-mainnet.matic.network",
      accounts: prodAccounts,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS ? true : false,
  },
};

export default config;
