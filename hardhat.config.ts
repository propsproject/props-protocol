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
import accounts from "./test-accounts";

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
    hardhat: { accounts },
    // Testnet configs
    goerli: {
      url: `https://goerli.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
      accounts: {
        mnemonic: process.env.MNEMONIC,
      },
    },
    mumbai: {
      url: "https://rpc-mumbai.matic.today",
      accounts: {
        mnemonic: process.env.MNEMONIC,
      },
    },
    // Mainnet configs
    mainnet: {
      url: `https://mainnet.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
      accounts: {
        // TODO: We'll probably need to hardcode the individual private keys instead of using a mnemonic
        mnemonic: process.env.MNEMONIC,
      },
    },
    matic: {
      url: "https://rpc-mainnet.matic.network",
      accounts: {
        // TODO: We'll probably need to hardcode the individual private keys instead of using a mnemonic
        mnemonic: process.env.MNEMONIC,
      },
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS ? true : false,
  },
};

export default config;
