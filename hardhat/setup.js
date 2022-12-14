const { network, ethers } = require('hardhat');
const curioABI = require('./abi.json');
const TestClaims = require('./test-claims.json');

console.log('starting setup.js');

(async () => {
  const [deployer] = await ethers.getSigners();

  CURIOS = await ethers.getContractAt(
    curioABI,
    '0x06BCab7137b300dA5A4d0Ce047a71F4e7192c1a3'
  );
  console.log(`CURIOS Live: ${CURIOS.address}`);

  let owner = await CURIOS.owner();

  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [owner],
  });
  let ownerSigner = await ethers.provider.getSigner(owner);

  await CURIOS.connect(ownerSigner).transferOwnership(deployer.address);
  console.log(`Change Ownership: ${deployer.address}`);

  // Unpause
  await CURIOS.unpause();
  console.log('Curios unpaused');

  // Loop around pre-made Claims and claim them
  for (let claim of TestClaims) {
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [claim.address],
    });
    let recipient = await ethers.provider.getSigner(claim.address);
    let tokenId = claim.nonce === 0 ? Math.floor(Math.random() * 32) + 1 : claim.nonce -1;
    await CURIOS.connect(recipient).claim(tokenId, claim.nonce, claim.claim);
  }
  console.log('Test claims complete')
})();
