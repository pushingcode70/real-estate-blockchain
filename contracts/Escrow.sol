// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

import "./interfaces/IPropertyNFT.sol";

contract Escrow is IERC721Receiver, ReentrancyGuard, AccessControl {

    // defines the possible states a property sale escrow can be in, from listing through completion, refund or expiry
    enum EscrowStatus {
        Listed,
        Funded,
        Inspection,
        Approved,
        Completed,
        Cancelled,
        Refunded,
        Expired
    }

    struct Listing {
        uint256 listingID; //diff from property or tokenid
        uint256 propertyID;
        uint256 tokenID;
        address payable seller; //payable is used bcz will recieve the sale payment
        address payable buyer; //may send or refund to buyer
        uint256 salePrice;
        uint256 deadline;
        EscrowStatus status;
        bytes32 inspectionReportHash;
    }

    //reference to the deployed nftproperty
    IPropertyNFT public immutable propertyNFT;

    uint256 private nextListingID = 1;

    //sores each escrow listing by unique listingid
    mapping(uint256 => Listing) public listings;

    //maps nft tokenid to its currently active  escrow listingid
    mapping(uint256 => uint256) public activeListingByToken;

    //buyer refund balances  that can be refunded.
    mapping(address => uint256) public pendingBalances;

    //temporarily stores the nft tokenid expected to be received by the escrow
    uint256 private expectedTokenID;

    error ListingNotFound();
    error InvalidPrice();
    error InvalidDeadline();
    error InvalidReportHash();
    error NotNFTOwner();
    error PropertyAlreadyListed();
    error NotSeller();
    error NotBuyer();
    error SellerCannotBuy();
    error IncorrectPayment();
    error InvalidState();
    error RefundFailed();//wont really happen buyer can retry later more of a safety hazard thing
    error NoFundsAvailable(); //in case they dont have refind amt or will try to redeem it multiple times
    error UnexpectedNFTTransfer();

    event PropertyListed(
        uint256 indexed listingID,
        uint256 indexed propertyID,
        uint256 indexed tokenID,
        address seller,
        uint256 price
    );

    event PriceUpdated(
        uint256 indexed listingID,
        uint256 newPrice
    );

    event EscrowFunded(
        uint256 indexed listingID,
        address indexed buyer,
        uint256 amount
    );

    event InspectionStarted(
        uint256 indexed listingID
    );

    event InspectionApproved(
        uint256 indexed listingID,
        bytes32 reportHash
    );

    event InspectionRejected(
        uint256 indexed listingID,
        bytes32 reportHash
    );

    event SaleCompleted(
        uint256 indexed listingID,
        address indexed buyer,
        address indexed seller
    );

    event SaleCancelled(
        uint256 indexed listingID
    );

    event EscrowExpired(
        uint256 indexed listingID
    );

    event RefundStored(
        address indexed buyer,
        uint256 amount
    );

    event FundsWithdrawn(
        address indexed account,//buyer can withdraw refund...seller can withdraw payout they get from selling
        uint256 amount
    );

    constructor(address propertyNFTAddress) {
        propertyNFT = IPropertyNFT(propertyNFTAddress);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function listProperty(
        uint256 propertyID,
        uint256 salePrice,
        uint256 deadline
    )
        external
        nonReentrant
        returns (uint256 listingID)
    {
        if (salePrice == 0)
            revert InvalidPrice();

        if (deadline <= block.timestamp)
            revert InvalidDeadline();

        uint256 tokenID = propertyNFT.getTokenForProperty(propertyID);
        
if (activeListingByToken[tokenID] != 0) {
    revert PropertyAlreadyListed();
}

if (propertyNFT.ownerOf(tokenID) != msg.sender) {
    revert NotNFTOwner();
}

        listingID = nextListingID;
        nextListingID++;

        listings[listingID] = Listing({
            listingID: listingID,
            propertyID: propertyID,
            tokenID: tokenID,
            seller: payable(msg.sender),
            buyer: payable(address(0)), //initialized to 0 as no buyer exists  when listing is created
            salePrice: salePrice,
            deadline: deadline,
            status: EscrowStatus.Listed,
            inspectionReportHash: bytes32(0) //same as buyer payable will be assigned values later when inspection created
        });

        activeListingByToken[tokenID] = listingID;

        expectedTokenID = tokenID;

        propertyNFT.safeTransferFrom(
            msg.sender,
            address(this),
            tokenID
        );

        expectedTokenID = 0;//resetting as we its need is over and will need for more listings

        emit PropertyListed(
            listingID,
            propertyID,
            tokenID,
            msg.sender,
            salePrice
        );
    }

    function updatePrice(
        uint256 listingID,
        uint256 newPrice
    )
        external
    {
        Listing storage listing = listings[listingID]; //uses the map Listing

        if (listing.listingID == 0)
            revert ListingNotFound();

        if (listing.seller != msg.sender)
            revert NotSeller();

        if (listing.status != EscrowStatus.Listed)
            revert InvalidState();

        if (newPrice == 0)
            revert InvalidPrice();

        listing.salePrice = newPrice;

        emit PriceUpdated(
            listingID,
            newPrice
        );
    }

    function fundEscrow(
        uint256 listingID
    )
        external
        payable
        nonReentrant
    {
        Listing storage listing = listings[listingID];

        if (listing.listingID == 0)
            revert ListingNotFound();

        if (listing.status != EscrowStatus.Listed)
            revert InvalidState();

        if (block.timestamp > listing.deadline)
            revert InvalidDeadline();

        if (msg.sender == listing.seller)
            revert SellerCannotBuy();

        if (msg.value != listing.salePrice)
            revert IncorrectPayment();

        listing.buyer = payable(msg.sender); //we had it initialized to 0 before
        listing.status = EscrowStatus.Funded;

        emit EscrowFunded(
            listingID,
            msg.sender,
            msg.value
        );
    }

    function startInspection(
        uint256 listingID
    )
        external
    {
        Listing storage listing = listings[listingID];

        if (listing.listingID == 0)
            revert ListingNotFound();

        if (listing.buyer != msg.sender)
            revert NotBuyer();

        if (listing.status != EscrowStatus.Funded) //if it doesnt pass the previous step it will revert
            revert InvalidState();

        listing.status = EscrowStatus.Inspection;

        emit InspectionStarted(listingID);
    }

    function updateInspectionStatus(
        uint256 listingID,
        bool passed,
        bytes32 reportHash
    )
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        Listing storage listing = listings[listingID];

        if (listing.listingID == 0)
            revert ListingNotFound();

        if (listing.status != EscrowStatus.Inspection)
            revert InvalidState();

        if (reportHash == bytes32(0))
            revert InvalidReportHash();

        listing.inspectionReportHash = reportHash;

        if (passed) {
            listing.status = EscrowStatus.Approved;

            emit InspectionApproved(listingID, reportHash);
            return;  // if all good it will stop the execution if not the next lines will be executed incase it blew up..the status will be changed to refunded
        }

        listing.status = EscrowStatus.Refunded;

        delete activeListingByToken[listing.tokenID];

        uint256 refundAmount = listing.salePrice;
        address payable buyer = listing.buyer;

        pendingBalances[buyer] += refundAmount; //take whatever refund amount is already recorded for this buyer and add the new refund to it if it had 0 than 0+what we owe or if its like 20 than 20 + what we owe if we owe 50 than 20+50(the one which is being refunded)

        emit InspectionRejected(
            listingID,
            reportHash
        );

        emit RefundStored(
            buyer,
            refundAmount
        );

        propertyNFT.safeTransferFrom(
            address(this), //(from....this) is escrow contract bcz its stored in escrow contract than it will be transferred to seller
            listing.seller, // to..
            listing.tokenID
        );
    }

    function withdrawFunds()external nonReentrant //external called by buyer and seller both

    //order is:
    //read refund
    //set refund = 0
    //send ETH
    //so the same refund can't be claimed repeatedly through reentrancy.
     {
        uint256 amount  = pendingBalances[msg.sender]; //read...how much caller is owed we already have pendingRefunds map uses buyer address->refund amt

        if (amount == 0)
        revert NoFundsAvailable();
        
         pendingBalances[msg.sender] = 0;//set

         (bool success, ) = payable(msg.sender).call{value: amount}("");

         if(!success) 
         revert RefundFailed();

         emit FundsWithdrawn(
            msg.sender ,//could be seller or buyer
            amount
         );
          
    }

    function onERC721Received(
    address,
    address,
    uint256 tokenID,
    bytes calldata
)
    external
    view
    override
    returns (bytes4)
{
    if (
        msg.sender != address(propertyNFT) ||
        tokenID != expectedTokenID ||
        expectedTokenID == 0
    ) {
        revert UnexpectedNFTTransfer();
    }

    return
        IERC721Receiver.onERC721Received.selector;
}

//we delete the listing from active listing only and keep listings record weather its failed or success

function finalizeSale(uint256 listingID) external  nonReentrant {
    //if this func  reverts for some other reason the balance addition is also rolled back because the whole transaction is atomic
    Listing storage listing = listings[listingID];

    if(listing.listingID == 0)
    revert ListingNotFound();

    if(listing.status != EscrowStatus.Approved)
    revert InvalidState();

    if (block.timestamp > listing.deadline)
    revert InvalidDeadline();

    listing.status =EscrowStatus.Completed;

    delete activeListingByToken[listing.tokenID];

    address buyer = listing.buyer;
    address payable seller = listing.seller;
    uint256 payout = listing.salePrice;

    pendingBalances[seller] += payout; //seller's ability to receive ETH immediately cannot block finalizeSale()..adds to the exsiting balance 


    propertyNFT.safeTransferFrom(
        address(this),
        buyer,
        listing.tokenID
    );

    emit SaleCompleted(
        listingID,
        buyer,
        seller
    );
}

function expireEscrow(uint256 listingID) external  nonReentrant
{

// nft and money are in escrow from the funded state onward
// if the transaction is not completed within the given deadline
// the escrow can be expired and the assets can be returned

    Listing storage listing = listings[listingID];

    if(listing.listingID == 0)
    revert ListingNotFound();

    if (block.timestamp <= listing.deadline)
        revert InvalidDeadline();


// it needs to be in these three stages because this is where it can time out or be cancelled after that the process is initialized    if (                    
       if(
        listing.status != EscrowStatus.Listed &&
        listing.status != EscrowStatus.Funded &&
        listing.status != EscrowStatus.Inspection
    )
        revert InvalidState();

        listing.status = EscrowStatus.Expired;

        delete activeListingByToken[listing.tokenID];

        if (listing.buyer != address(0)){ //address(0) means no buyer has funded the listing yet
        uint256 refundAmount =listing.salePrice;

        //giving back the eth to buyer
        pendingBalances[listing.buyer] += refundAmount;
         emit RefundStored(
            listing.buyer,
            refundAmount
         );
        }
         emit EscrowExpired(listingID);

         //gives nft back to the seller
         propertyNFT.safeTransferFrom(
            address(this),
            listing.seller,
            listing.tokenID
         );
}

function cancelListing(
    uint256 listingID
)
    external
    nonReentrant
{
    Listing storage listing = listings[listingID];

    if (listing.listingID == 0)
        revert ListingNotFound();

    if (listing.seller != msg.sender)
        revert NotSeller();

    if (listing.status != EscrowStatus.Listed)
        revert InvalidState();

    listing.status = EscrowStatus.Cancelled;

    delete activeListingByToken[listing.tokenID];

    emit SaleCancelled(listingID);

    propertyNFT.safeTransferFrom(
        address(this),
        listing.seller,
        listing.tokenID
    );
}
}
//in context to last func
// safeTransferFrom is not just a simple transfer
// if the buyer is a smart contract it triggers the buyers onERC721Received function
// this gives control to the buyer before the seller gets their money
// even with nonReentrant always update internal ledgers before handing control to an external contract