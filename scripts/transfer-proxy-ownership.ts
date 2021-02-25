import { upgrades } from "hardhat";

async function main() {
  const owner = process.env.OWNER;
  if (!owner) {
    throw new Error(`Missing OWNER - the new owner of the ProxyAdmin contract`);
  }

  console.log("Transferring ProxyAdmin ownership...");
  await upgrades.admin.transferProxyAdminOwnership(owner as string);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
