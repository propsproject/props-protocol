const { accounts, contract } = require('@openzeppelin/test-environment');
const { expect } = require('chai');
const PropsRewardsLibrary = contract.fromArtifact('PropsRewardsLib')
const PropsRewardsContract = contract.fromArtifact('PropsRewards');

describe('PropsRewards', function () {
    const [ admin, validator, application ] = accounts;
    const secondsBetweenDays = 3600;
    const rewardsStartTimestamp = 1588666086;
    //TODO: placeholders here now - will need for testing to deploy and initialize these two contracts
    const tokenContractAddress = "0x6d3c614694c6421827a553fb7f0094ac42e6b61e";
    const identityContractAddress = "0x2515cdd51b1d8782cf9301bffa2c8decdc6263fa";
    
    beforeEach(async function() {      
      this.propsRewardsLibrary = await PropsRewardsLibrary.new();      
      await PropsRewardsContract.detectNetwork();                  
      await PropsRewardsContract.link({"PropsRewardsLib": this.propsRewardsLibrary.address});            
      this.propsRewardsContract = await PropsRewardsContract.new(admin, tokenContractAddress, identityContractAddress, secondsBetweenDays, rewardsStartTimestamp);  
      await this.propsRewardsContract.initialize(admin, tokenContractAddress, identityContractAddress, secondsBetweenDays, rewardsStartTimestamp);
    });
    describe('Basic Initialization Tests', function() {
      it('Owner is properly set', async function () {      
        expect(await this.propsRewardsContract.owner()).to.equal(admin);
      });
      it('Rewards Timestamp and seconds per day are properly set', async function () {
        const timestamp = await this.propsRewardsContract.rewardsStartTimestamp();
        const sec = await this.propsRewardsContract.secondsBetweenDays();
        expect(timestamp.toString()).to.equal(rewardsStartTimestamp.toString());
        expect(sec.toString()).to.equal(secondsBetweenDays.toString());
      });
      it('Token and Identity contracts are set', async function () {
        const tokenAddr = await this.propsRewardsContract.tokenContract();
        const identityAddr = await this.propsRewardsContract.identityContract();
        expect(tokenAddr.toString()).to.equal(tokenAddr);
        expect(identityAddr.toString()).to.equal(identityAddr);
      });
    });
  });