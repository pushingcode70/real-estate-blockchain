import { expect } from "chai";
import { network } from "hardhat";

describe("PropertyRegistry", function () {
  async function deployRegistry() {
    const { ethers } = await network.connect();

    const [admin, seller, stranger] = await ethers.getSigners();

    const PropertyRegistry = await ethers.getContractFactory(
      "PropertyRegistry"
    );

    const registry = await PropertyRegistry.deploy();

    return { registry, admin, seller, stranger, ethers };
  }

  it("should give the deployer admin role", async function () {
    const { registry, admin } = await deployRegistry();

    const DEFAULT_ADMIN_ROLE =
      await registry.DEFAULT_ADMIN_ROLE();

    expect(
      await registry.hasRole(
        DEFAULT_ADMIN_ROLE,
        admin.address
      )
    ).to.equal(true);
  });

  it("should allow a seller to submit a property", async function () {
    const { registry, seller, ethers } =
      await deployRegistry();

    const documentHash = ethers.keccak256(
      ethers.toUtf8Bytes("property-document")
    );

    await registry.connect(seller).submitProperty(
      "REG-001",
      "ipfs://property-001",
      documentHash
    );

    const property = await registry.properties(1);

    expect(property.propertyID).to.equal(1);
    expect(property.registrationNumber).to.equal(
      "REG-001"
    );
    expect(property.metadataURI).to.equal(
      "ipfs://property-001"
    );
    expect(property.documentHash).to.equal(
      documentHash
    );
    expect(property.submitter).to.equal(
      seller.address
    );
    expect(property.status).to.equal(0);
  });

  it("should allow an admin to verify a pending property", async function () {
    const { registry, seller, admin, ethers } =
      await deployRegistry();

    const documentHash = ethers.keccak256(
      ethers.toUtf8Bytes("property-document")
    );

    await registry.connect(seller).submitProperty(
      "REG-001",
      "ipfs://property-001",
      documentHash
    );

    await registry.connect(admin).verifyProperty(1);

    const property = await registry.properties(1);

    expect(property.status).to.equal(1);
  });

  it("should prevent a non-admin from verifying a property", async function () {
    const { registry, seller, stranger, ethers } =
      await deployRegistry();

    const documentHash = ethers.keccak256(
      ethers.toUtf8Bytes("property-document")
    );

    await registry.connect(seller).submitProperty(
      "REG-001",
      "ipfs://property-001",
      documentHash
    );

    const DEFAULT_ADMIN_ROLE =
      await registry.DEFAULT_ADMIN_ROLE();

    await expect(
      registry.connect(stranger).verifyProperty(1)
    )
      .to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount"
      )
      .withArgs(
        stranger.address,
        DEFAULT_ADMIN_ROLE
      );
  });

  it("should not allow a property to be verified twice", async function () {
    const { registry, seller, admin, ethers } =
      await deployRegistry();

    const documentHash = ethers.keccak256(
      ethers.toUtf8Bytes("property-document")
    );

    await registry.connect(seller).submitProperty(
      "REG-001",
      "ipfs://property-001",
      documentHash
    );

    await registry.connect(admin).verifyProperty(1);

    await expect(
      registry.connect(admin).verifyProperty(1)
    ).to.be.revertedWith(
      "Property already verified"
    );
  });
});