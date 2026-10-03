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

    async function getFutureDeadline(seconds = 3600) {
        const latestBlock = await ethers.provider.getBlock("latest");

        if (!latestBlock) {
            throw new Error("Latest block not found");
        }

        return BigInt(latestBlock.timestamp + seconds);
    }

    async function movePastDeadline(seconds = 7200) {
        await ethers.provider.send("evm_increaseTime", [seconds]);
        await ethers.provider.send("evm_mine", []);
    }

    async function prepareListing(price = salePrice, deadline?: bigint) {
        const propertyID = await createVerifiedProperty();
        const tokenID = await propertyNFT.getTokenForProperty(propertyID);

        await propertyNFT.connect(seller).approve(
            await escrow.getAddress(),
            tokenID
        );

        const listingDeadline = deadline ?? await getFutureDeadline();

        await escrow.connect(seller).listProperty(
            propertyID,
            price,
            listingDeadline
        );

        return {
            propertyID,
            tokenID,
            listingID: 1n,
            deadline: listingDeadline
        };
    }

    async function prepareFundedListing() {
        const listing = await prepareListing();

        await escrow.connect(buyer).fundEscrow(
            listing.listingID,
            { value: salePrice }
        );

        return listing;
    }

    beforeEach(async function () {
    const connection = await network.connect();
    ethers = connection.ethers;

    [admin, seller, buyer, otherUser] = await ethers.getSigners();

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

    describe("listing", function () {
        it("creates a listing and moves the NFT into escrow", async function () {
            const listing = await prepareListing();

            const storedListing = await escrow.listings(listing.listingID);

            expect(storedListing.listingID).to.equal(listing.listingID);
            expect(storedListing.propertyID).to.equal(listing.propertyID);
            expect(storedListing.tokenID).to.equal(listing.tokenID);
            expect(storedListing.seller).to.equal(seller.address);
            expect(storedListing.buyer).to.equal(ethers.ZeroAddress);
            expect(storedListing.salePrice).to.equal(salePrice);
            expect(storedListing.status).to.equal(0n);

            expect(
                await propertyNFT.ownerOf(listing.tokenID)
            ).to.equal(await escrow.getAddress());

            expect(
                await escrow.activeListingByToken(listing.tokenID)
            ).to.equal(listing.listingID);
        });

        it("rejects zero price", async function () {
            const propertyID = await createVerifiedProperty();
            const deadline = await getFutureDeadline();

            await expect(
                escrow.connect(seller).listProperty(
                    propertyID,
                    0,
                    deadline
                )
            ).to.be.revertedWithCustomError(escrow, "InvalidPrice");
        });

        it("rejects an expired deadline", async function () {
            const propertyID = await createVerifiedProperty();
            const deadline = await getFutureDeadline(60);

            await movePastDeadline(120);

            await expect(
                escrow.connect(seller).listProperty(
                    propertyID,
                    salePrice,
                    deadline
                )
            ).to.be.revertedWithCustomError(escrow, "InvalidDeadline");
        });

        it("rejects listing when the caller does not own the NFT", async function () {
            const propertyID = await createVerifiedProperty();
            const deadline = await getFutureDeadline();

            await expect(
                escrow.connect(otherUser).listProperty(
                    propertyID,
                    salePrice,
                    deadline
                )
            ).to.be.revertedWithCustomError(escrow, "NotNFTOwner");
        });

        it("prevents the same NFT from having two active listings", async function () {
            const firstListing = await prepareListing();

            await expect(
                escrow.connect(seller).listProperty(
                    firstListing.propertyID,
                    salePrice,
                    firstListing.deadline
                )
            ).to.be.revertedWithCustomError(
                escrow,
                "PropertyAlreadyListed"
            );
        });

it("prevents direct NFT transfers into escrow", async function () {
            const propertyID = await createVerifiedProperty();
            const tokenID = await propertyNFT.getTokenForProperty(propertyID);

            await propertyNFT.connect(seller).approve(
                await escrow.getAddress(),
                tokenID
            );

            await expect(
                propertyNFT.connect(seller).safeTransferFrom(
                    seller.address,
                    await escrow.getAddress(),
                    tokenID
                )
            ).to.be.revertedWithCustomError(
    propertyNFT,
    "TransferNotAllowed"
);
        });
    });

    describe("price updates", function () {
        it("allows the seller to update price while listed", async function () {
            const listing = await prepareListing();

            await expect(
                escrow.connect(seller).updatePrice(
                    listing.listingID,
                    newPrice
                )
            )
                .to.emit(escrow, "PriceUpdated")
                .withArgs(listing.listingID, newPrice);

            const storedListing = await escrow.listings(listing.listingID);

            expect(storedListing.salePrice).to.equal(newPrice);
        });

        it("prevents another account from updating the price", async function () {
            const listing = await prepareListing();

            await expect(
                escrow.connect(otherUser).updatePrice(
                    listing.listingID,
                    newPrice
                )
            ).to.be.revertedWithCustomError(escrow, "NotSeller");
        });

        it("locks the price after the escrow is funded", async function () {
            const listing = await prepareListing();

            await escrow.connect(buyer).fundEscrow(
                listing.listingID,
                { value: salePrice }
            );

            await expect(
                escrow.connect(seller).updatePrice(
                    listing.listingID,
                    newPrice
                )
            ).to.be.revertedWithCustomError(escrow, "InvalidState");
        });
    });

    describe("funding", function () {
        it("funds the escrow and records the buyer", async function () {
            const listing = await prepareListing();

            await expect(
                escrow.connect(buyer).fundEscrow(
                    listing.listingID,
                    { value: salePrice }
                )
            )
                .to.emit(escrow, "EscrowFunded")
                .withArgs(
                    listing.listingID,
                    buyer.address,
                    salePrice
                );

            const storedListing = await escrow.listings(listing.listingID);

            expect(storedListing.buyer).to.equal(buyer.address);
            expect(storedListing.status).to.equal(1n);
        });

        it("rejects funding from the seller", async function () {
            const listing = await prepareListing();

            await expect(
                escrow.connect(seller).fundEscrow(
                    listing.listingID,
                    { value: salePrice }
                )
            ).to.be.revertedWithCustomError(
                escrow,
                "SellerCannotBuy"
            );
        });

        it("rejects incorrect payment", async function () {
            const listing = await prepareListing();

            await expect(
                escrow.connect(buyer).fundEscrow(
                    listing.listingID,
                    { value: ethers.parseEther("5") }
                )
            ).to.be.revertedWithCustomError(
                escrow,
                "IncorrectPayment"
            );
        });

        it("rejects funding after the deadline", async function () {
            const deadline = await getFutureDeadline(60);
            const listing = await prepareListing(salePrice, deadline);

            await movePastDeadline(120);

            await expect(
                escrow.connect(buyer).fundEscrow(
                    listing.listingID,
                    { value: salePrice }
                )
            ).to.be.revertedWithCustomError(
                escrow,
                "InvalidDeadline"
            );
        });
    });

    describe("inspection", function () {
        it("moves a funded escrow into inspection", async function () {
            const listing = await prepareFundedListing();

            await expect(
                escrow.connect(buyer).startInspection(
                    listing.listingID
                )
            )
                .to.emit(escrow, "InspectionStarted")
                .withArgs(listing.listingID);

            const storedListing = await escrow.listings(listing.listingID);

            expect(storedListing.status).to.equal(2n);
        });

        it("allows only the buyer to start inspection", async function () {
            const listing = await prepareFundedListing();

            await expect(
                escrow.connect(otherUser).startInspection(
                    listing.listingID
                )
            ).to.be.revertedWithCustomError(escrow, "NotBuyer");
        });

        it("allows only the admin to update inspection status", async function () {
            const listing = await prepareFundedListing();

            await escrow.connect(buyer).startInspection(
                listing.listingID
            );

            const reportHash = ethers.keccak256(
                ethers.toUtf8Bytes("passed-report")
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

        it("rejects an empty inspection report hash", async function () {
            const listing = await prepareFundedListing();

            await escrow.connect(buyer).startInspection(
                listing.listingID
            );

            await expect(
                escrow.connect(admin).updateInspectionStatus(
                    listing.listingID,
                    true,
                    ethers.ZeroHash
                )
            ).to.be.revertedWithCustomError(
                escrow,
                "InvalidReportHash"
            );
        });
    });

    describe("successful sale", function () {
        it("completes the sale and transfers the NFT to the buyer", async function () {
            const listing = await prepareFundedListing();

            await escrow.connect(buyer).startInspection(
                listing.listingID
            );

            const reportHash = ethers.keccak256(
                ethers.toUtf8Bytes("passed-report")
            );

            await expect(
                escrow.connect(admin).updateInspectionStatus(
                    listing.listingID,
                    true,
                    reportHash
                )
            )
                .to.emit(escrow, "InspectionApproved")
                .withArgs(listing.listingID, reportHash);

            const approvedListing = await escrow.listings(
                listing.listingID
            );

            expect(approvedListing.status).to.equal(3n);

            await expect(
                escrow.connect(otherUser).finalizeSale(
                    listing.listingID
                )
            )
                .to.emit(escrow, "SaleCompleted")
                .withArgs(
                    listing.listingID,
                    buyer.address,
                    seller.address
                );

            const completedListing = await escrow.listings(
                listing.listingID
            );

            expect(completedListing.status).to.equal(4n);

            expect(
                await propertyNFT.ownerOf(listing.tokenID)
            ).to.equal(buyer.address);

            expect(
                await escrow.activeListingByToken(listing.tokenID)
            ).to.equal(0n);

            expect(
                await escrow.pendingBalances(seller.address)
            ).to.equal(salePrice);
        });

        it("allows the seller to withdraw the sale payout", async function () {
            const listing = await prepareFundedListing();

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

            const sellerBalanceBefore =
                await ethers.provider.getBalance(seller.address);

            const tx = await escrow.connect(seller).withdrawFunds();
            const receipt = await tx.wait();

            const sellerBalanceAfter =
                await ethers.provider.getBalance(seller.address);

            const gasCost =
                receipt.gasUsed * receipt.gasPrice;

            expect(
                sellerBalanceAfter + gasCost - sellerBalanceBefore
            ).to.equal(salePrice);

            expect(
                await escrow.pendingBalances(seller.address)
            ).to.equal(0n);
        });

        it("rejects completing a sale before inspection approval", async function () {
            const listing = await prepareFundedListing();

            await expect(
                escrow.connect(otherUser).finalizeSale(
                    listing.listingID
                )
            ).to.be.revertedWithCustomError(
                escrow,
                "InvalidState"
            );
        });
    });

    describe("failed inspection and refund", function () {
        it("refunds the buyer and returns the NFT to the seller", async function () {
            const listing = await prepareFundedListing();

            await escrow.connect(buyer).startInspection(
                listing.listingID
            );

            const reportHash = ethers.keccak256(
                ethers.toUtf8Bytes("failed-report")
            );

            await expect(
                escrow.connect(admin).updateInspectionStatus(
                    listing.listingID,
                    false,
                    reportHash
                )
            )
                .to.emit(escrow, "InspectionRejected")
                .withArgs(listing.listingID, reportHash);

            const storedListing = await escrow.listings(
                listing.listingID
            );

            expect(storedListing.status).to.equal(6n);
            expect(storedListing.inspectionReportHash).to.equal(reportHash);

            expect(
                await escrow.pendingBalances(buyer.address)
            ).to.equal(salePrice);

            expect(
                await propertyNFT.ownerOf(listing.tokenID)
            ).to.equal(seller.address);

            expect(
                await escrow.activeListingByToken(listing.tokenID)
            ).to.equal(0n);
        });

        it("allows the buyer to withdraw the refund", async function () {
            const listing = await prepareFundedListing();

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

            const buyerBalanceBefore =
                await ethers.provider.getBalance(buyer.address);

            const tx = await escrow.connect(buyer).withdrawFunds();
            const receipt = await tx.wait();

            const buyerBalanceAfter =
                await ethers.provider.getBalance(buyer.address);

            const gasCost =
                receipt.gasUsed * receipt.gasPrice;

            expect(
                buyerBalanceAfter + gasCost - buyerBalanceBefore
            ).to.equal(salePrice);

            expect(
                await escrow.pendingBalances(buyer.address)
            ).to.equal(0n);
        });

        it("prevents withdrawing funds when no balance exists", async function () {
            await expect(
                escrow.connect(buyer).withdrawFunds()
            ).to.be.revertedWithCustomError(
                escrow,
                "NoFundsAvailable"
            );
        });
    });

    describe("expiry", function () {
        it("expires a listed escrow after its deadline and returns the NFT", async function () {
            const deadline = await getFutureDeadline(60);
            const listing = await prepareListing(salePrice, deadline);

            await movePastDeadline(120);

            await expect(
                escrow.connect(otherUser).expireEscrow(
                    listing.listingID
                )
            )
                .to.emit(escrow, "EscrowExpired")
                .withArgs(listing.listingID);

            const storedListing = await escrow.listings(
                listing.listingID
            );

            expect(storedListing.status).to.equal(7n);
            expect(
                await propertyNFT.ownerOf(listing.tokenID)
            ).to.equal(seller.address);

            expect(
                await escrow.pendingBalances(buyer.address)
            ).to.equal(0n);

            expect(
                await escrow.activeListingByToken(listing.tokenID)
            ).to.equal(0n);
        });

        it("expires a funded escrow and stores the buyer refund", async function () {
            const deadline = await getFutureDeadline(60);
            const listing = await prepareListing(salePrice, deadline);

            await escrow.connect(buyer).fundEscrow(
                listing.listingID,
                { value: salePrice }
            );

            await movePastDeadline(120);

            await expect(
                escrow.connect(otherUser).expireEscrow(
                    listing.listingID
                )
            ).to.emit(escrow, "RefundStored")
                .withArgs(buyer.address, salePrice);

            const storedListing = await escrow.listings(
                listing.listingID
            );

            expect(storedListing.status).to.equal(7n);

            expect(
                await escrow.pendingBalances(buyer.address)
            ).to.equal(salePrice);

            expect(
                await propertyNFT.ownerOf(listing.tokenID)
            ).to.equal(seller.address);
        });

        it("rejects expiry before the deadline", async function () {
            const listing = await prepareListing();

            await expect(
                escrow.connect(otherUser).expireEscrow(
                    listing.listingID
                )
            ).to.be.revertedWithCustomError(
                escrow,
                "InvalidDeadline"
            );
        });

        it("cannot expire a completed escrow", async function () {
            const listing = await prepareFundedListing();

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

            await movePastDeadline(7200);

            await expect(
                escrow.connect(otherUser).expireEscrow(
                    listing.listingID
                )
            ).to.be.revertedWithCustomError(
                escrow,
                "InvalidState"
            );
        });
    });

    describe("cancellation", function () {
        it("allows the seller to cancel a listed property", async function () {
            const listing = await prepareListing();

            await expect(
                escrow.connect(seller).cancelListing(
                    listing.listingID
                )
            )
                .to.emit(escrow, "SaleCancelled")
                .withArgs(listing.listingID);

            const storedListing = await escrow.listings(
                listing.listingID
            );

            expect(storedListing.status).to.equal(5n);

            expect(
                await propertyNFT.ownerOf(listing.tokenID)
            ).to.equal(seller.address);

            expect(
                await escrow.activeListingByToken(listing.tokenID)
            ).to.equal(0n);

            expect(
                await escrow.pendingBalances(seller.address)
            ).to.equal(0n);
        });

        it("prevents another account from cancelling the listing", async function () {
            const listing = await prepareListing();

            await expect(
                escrow.connect(otherUser).cancelListing(
                    listing.listingID
                )
            ).to.be.revertedWithCustomError(
                escrow,
                "NotSeller"
            );
        });

        it("prevents cancellation after funding", async function () {
            const listing = await prepareFundedListing();

            await expect(
                escrow.connect(seller).cancelListing(
                    listing.listingID
                )
            ).to.be.revertedWithCustomError(
                escrow,
                "InvalidState"
            );
        });
    });
});
