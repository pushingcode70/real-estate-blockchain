import { expect } from "chai";
import { network } from "hardhat";

describe("Escrow", function () {
    let ethers: any;
    let registry: any;
    let propertyNFT: any;
    let escrow: any;

    let admin: any;
    let seller: any;
    let buyer: any;
    let otherUser: any;

    const salePrice = 10n * 10n ** 18n;
    const newPrice = 12n * 10n ** 18n;

    async function futureDeadline(seconds = 3600) {
        const block = await ethers.provider.getBlock("latest");
        return BigInt(block!.timestamp + seconds);
    }

    async function createVerifiedProperty() {
        const documentHash = ethers.keccak256(
            ethers.toUtf8Bytes("property-document")
        );

        await registry.connect(seller).submitProperty(
            "REG-001",
            "ipfs://property-metadata",
            documentHash
        );

        await registry.connect(admin).verifyProperty(1);
        await propertyNFT.connect(admin).mintProperty(1);

        return 1n;
    }

    async function createListing() {
        const propertyID = await createVerifiedProperty();
        const tokenID = await propertyNFT.getTokenForProperty(propertyID);
        const deadline = await futureDeadline();

        await propertyNFT.connect(seller).approve(
            await escrow.getAddress(),
            tokenID
        );

        await escrow.connect(seller).listProperty(
            propertyID,
            salePrice,
            deadline
        );

        return { propertyID, tokenID, listingID: 1n, deadline };
    }

    async function fundListing() {
        const listing = await createListing();

        await escrow.connect(buyer).fundEscrow(
            listing.listingID,
            { value: salePrice }
        );

        return listing;
    }

    beforeEach(async function () {
        const connection = await network.connect();
        ethers = connection.ethers;

        [admin, seller, buyer, otherUser] =
            await ethers.getSigners();

        const Registry = await ethers.getContractFactory("PropertyRegistry");
        registry = await Registry.deploy();
        await registry.waitForDeployment();

        const PropertyNFT = await ethers.getContractFactory("PropertyNFT");
        propertyNFT = await PropertyNFT.deploy(
            await registry.getAddress()
        );
        await propertyNFT.waitForDeployment();

        const Escrow = await ethers.getContractFactory("Escrow");
        escrow = await Escrow.deploy(
            await propertyNFT.getAddress()
        );
        await escrow.waitForDeployment();

        await propertyNFT.connect(admin).setEscrow(
            await escrow.getAddress()
        );
    });

    describe("Basic escrow flow", function () {
        it("lists a property and stores the listing", async function () {
            const listing = await createListing();
            const stored = await escrow.listings(listing.listingID);

            expect(stored.propertyID).to.equal(listing.propertyID);
            expect(stored.seller).to.equal(seller.address);
            expect(stored.salePrice).to.equal(salePrice);
            expect(stored.status).to.equal(0n); // Listed

            expect(
                await propertyNFT.ownerOf(listing.tokenID)
            ).to.equal(await escrow.getAddress());
        });

        it("allows the seller to change the price", async function () {
            const listing = await createListing();

            await escrow.connect(seller).updatePrice(
                listing.listingID,
                newPrice
            );

            const stored = await escrow.listings(listing.listingID);
            expect(stored.salePrice).to.equal(newPrice);
        });

        it("allows the buyer to fund the escrow", async function () {
            const listing = await createListing();

            await escrow.connect(buyer).fundEscrow(
                listing.listingID,
                { value: salePrice }
            );

            const stored = await escrow.listings(listing.listingID);
            expect(stored.buyer).to.equal(buyer.address);
            expect(stored.status).to.equal(1n); // Funded
        });

        it("starts inspection after funding", async function () {
            const listing = await fundListing();

            await escrow.connect(buyer).startInspection(
                listing.listingID
            );

            const stored = await escrow.listings(listing.listingID);
            expect(stored.status).to.equal(2n); // Inspection
        });
    });

    describe("Successful sale", function () {
        it("completes the sale after inspection approval", async function () {
            const listing = await fundListing();

            await escrow.connect(buyer).startInspection(
                listing.listingID
            );

            const reportHash = ethers.keccak256(
                ethers.toUtf8Bytes("passed-report")
            );

            await escrow.connect(admin).updateInspectionStatus(
                listing.listingID,
                true,
                reportHash
            );

            await escrow.connect(otherUser).finalizeSale(
                listing.listingID
            );

            const stored = await escrow.listings(listing.listingID);

            expect(stored.status).to.equal(4n); // Completed
            expect(
                await propertyNFT.ownerOf(listing.tokenID)
            ).to.equal(buyer.address);
            expect(
                await escrow.pendingBalances(seller.address)
            ).to.equal(salePrice);
        });

        it("does not allow the sale before inspection approval", async function () {
            const listing = await fundListing();

            await expect(
                escrow.finalizeSale(listing.listingID)
            ).to.be.revertedWithCustomError(escrow, "InvalidState");
        });
    });

    describe("Failed sale and refund", function () {
        it("refunds the buyer when inspection fails", async function () {
            const listing = await fundListing();

            await escrow.connect(buyer).startInspection(
                listing.listingID
            );

            const reportHash = ethers.keccak256(
                ethers.toUtf8Bytes("failed-report")
            );

            await escrow.connect(admin).updateInspectionStatus(
                listing.listingID,
                false,
                reportHash
            );

            const stored = await escrow.listings(listing.listingID);

            expect(stored.status).to.equal(6n); // Refunded
            expect(
                await escrow.pendingBalances(buyer.address)
            ).to.equal(salePrice);
            expect(
                await propertyNFT.ownerOf(listing.tokenID)
            ).to.equal(seller.address);
        });

        it("rejects inspection updates from a non-admin", async function () {
            const listing = await fundListing();

            await escrow.connect(buyer).startInspection(
                listing.listingID
            );

            const reportHash = ethers.keccak256(
                ethers.toUtf8Bytes("report")
            );

            await expect(
                escrow.connect(otherUser).updateInspectionStatus(
                    listing.listingID,
                    true,
                    reportHash
                )
            ).to.be.revertedWithCustomError(
                escrow,
                "AccessControlUnauthorizedAccount"
            );
        });
    });

    describe("Expiry and cancellation", function () {
        it("expires a listing after the deadline", async function () {
            const deadline = await futureDeadline(60);
            const propertyID = await createVerifiedProperty();
            const tokenID = await propertyNFT.getTokenForProperty(propertyID);

            await propertyNFT.connect(seller).approve(
                await escrow.getAddress(),
                tokenID
            );

            await escrow.connect(seller).listProperty(
                propertyID,
                salePrice,
                deadline
            );

            await ethers.provider.send("evm_increaseTime", [120]);
            await ethers.provider.send("evm_mine", []);

            await escrow.expireEscrow(1n);

            const stored = await escrow.listings(1n);

            expect(stored.status).to.equal(7n); // Expired
            expect(
                await propertyNFT.ownerOf(tokenID)
            ).to.equal(seller.address);
        });

        it("returns the NFT and refund when a funded listing expires", async function () {
            const deadline = await futureDeadline(60);
            const propertyID = await createVerifiedProperty();
            const tokenID = await propertyNFT.getTokenForProperty(propertyID);

            await propertyNFT.connect(seller).approve(
                await escrow.getAddress(),
                tokenID
            );

            await escrow.connect(seller).listProperty(
                propertyID,
                salePrice,
                deadline
            );

            await escrow.connect(buyer).fundEscrow(
                1n,
                { value: salePrice }
            );

            await ethers.provider.send("evm_increaseTime", [120]);
            await ethers.provider.send("evm_mine", []);

            await escrow.expireEscrow(1n);

            expect(
                await escrow.pendingBalances(buyer.address)
            ).to.equal(salePrice);
            expect(
                await propertyNFT.ownerOf(tokenID)
            ).to.equal(seller.address);
        });

        it("allows the seller to cancel a listed property", async function () {
            const listing = await createListing();

            await escrow.connect(seller).cancelListing(
                listing.listingID
            );

            const stored = await escrow.listings(listing.listingID);

            expect(stored.status).to.equal(5n); // Cancelled
            expect(
                await propertyNFT.ownerOf(listing.tokenID)
            ).to.equal(seller.address);
        });
    });
});
