import { expect } from "chai";
import { network } from "hardhat";

describe("PropertyNFT", function () {
  async function deployContracts() {
    const { ethers } = await network.connect();

    const [admin, seller, stranger] =
      await ethers.getSigners();

    const PropertyRegistry =
      await ethers.getContractFactory("PropertyRegistry");

    const registry = await PropertyRegistry.deploy();

    const PropertyNFT =
      await ethers.getContractFactory("PropertyNFT");

    const nft = await PropertyNFT.deploy(
      await registry.getAddress()
    );

    return {
      registry,
      nft,
      admin,
      seller,
      stranger,
      ethers
    };
  }

  async function submitAndVerify(
    registry: any,
    seller: any,
    admin: any,
    ethers: any
  ) {
    const documentHash = ethers.keccak256(
      ethers.toUtf8Bytes("property-document")
    );

    await registry.connect(seller).submitProperty(
      "REG-001",
      "ipfs://property-001",
      documentHash
    );

    await registry.connect(admin).verifyProperty(1);
  }

  it("should allow admin to mint a verified property", async function () {
    const {
      registry,
      nft,
      seller,
      admin,
      ethers
    } = await deployContracts();

    await submitAndVerify(
      registry,
      seller,
      admin,
      ethers
    );

    await nft.connect(admin).mintProperty(1);

    expect(
      await nft.ownerOf(1)
    ).to.equal(seller.address);
  });

  it("should not allow minting an unverified property", async function () {
    const {
      registry,
      nft,
      admin
    } = await deployContracts();

    await registry.connect(admin).submitProperty(
      "REG-001",
      "ipfs://property-001",
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    );

    await expect(
      nft.connect(admin).mintProperty(1)
    ).to.be.revertedWith("Property not verified");
  });

  it("should not allow the same property to be minted twice", async function () {
    const {
      registry,
      nft,
      seller,
      admin,
      ethers
    } = await deployContracts();

    await submitAndVerify(
      registry,
      seller,
      admin,
      ethers
    );

    await nft.connect(admin).mintProperty(1);

    await expect(
      nft.connect(admin).mintProperty(1)
    ).to.be.revertedWith(
      "Property already minted"
    );
  });

  it("should not allow a non-minter to mint a property", async function () {
    const {
      registry,
      nft,
      seller,
      stranger,
      admin,
      ethers
    } = await deployContracts();

    await submitAndVerify(
      registry,
      seller,
      admin,
      ethers
    );

    const MINTER_ROLE =
      await nft.MINTER_ROLE();

    await expect(
      nft.connect(stranger).mintProperty(1)
    )
      .to.be.revertedWithCustomError(
        nft,
        "AccessControlUnauthorizedAccount"
      )
      .withArgs(
        stranger.address,
        MINTER_ROLE
      );
  });

  it("should store the property-to-token relationship", async function () {
    const {
      registry,
      nft,
      seller,
      admin,
      ethers
    } = await deployContracts();

    await submitAndVerify(
      registry,
      seller,
      admin,
      ethers
    );

    await nft.connect(admin).mintProperty(1);

    expect(
      await nft.propertyToToken(1)
    ).to.equal(1);

    expect(
      await nft.tokenMinted(1)
    ).to.equal(true);
  });

  it("should assign the correct metadata URI", async function () {
    const {
      registry,
      nft,
      seller,
      admin,
      ethers
    } = await deployContracts();

    await submitAndVerify(
      registry,
      seller,
      admin,
      ethers
    );

    await nft.connect(admin).mintProperty(1);

    expect(
      await nft.tokenURI(1)
    ).to.equal("ipfs://property-001");
  });
});