// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

//who owns the blockchain representation of this verified property?

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IPropertyRegistry.sol";

contract PropertyNFT is ERC721URIStorage, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    IPropertyRegistry public immutable registry;

    address public escrow; //transaction gonna go through  escrow once they are in it

    uint256 private nextTokenID = 1;

    //propertyID -> tokenID
    mapping(uint256 => uint256) public  propertyToToken;

    //propertyID weather an nft had already been minted
    mapping(uint256 => bool) public tokenMinted;

    event PropertyNFTMinted(
        uint256 indexed propertyID,
        uint256 indexed tokenID,
        address indexed owner
    );

error EscrowAlreadySet();
error InvalidEscrowAddress();
error TransferNotAllowed();

    constructor(address registryAddress)
    ERC721("RealEstateProperty", "REP")
    {
        registry = IPropertyRegistry(registryAddress);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    function setEscrow(address escrowAddress) external onlyRole(DEFAULT_ADMIN_ROLE){
        if(escrow != address(0))
        revert EscrowAlreadySet();

        if(escrowAddress==address(0))
        revert InvalidEscrowAddress();

        escrow = escrowAddress;
    }

    // restricts transfers of existing NFTs so that only the escrow contract can move them while still allowing minting
    function _update(
        address to,
        uint256 tokenID,
        address auth
    )
        internal 
        override
        returns(address){
            address from = super._update(
                to,
                tokenID,
                auth
            );
            //auth value is passed down from OpenZeppelin ERC-721 transfer logic
            //minting is allowed..after minting only escrow can move nft
            if(
                from != address(0) && msg.sender != escrow
            ){
                revert TransferNotAllowed();
            }

            return from;
        }

    function mintProperty(uint256 propertyID)
    external
    onlyRole(MINTER_ROLE) 
    returns (uint256 tokenID)
    {
        require(
            registry.isVerified(propertyID),
            "Property not verified"
        );

        require (
            !tokenMinted[propertyID],
            "Property already minted"
        );



     address propertyOwner = registry.getPropertySubmitter(propertyID);

        require(
            propertyOwner != address(0),
            "Invalid property owner"
        );
         string memory metadataURI = registry.getPropertyMetadataURI(propertyID);

         tokenID = nextTokenID;
         nextTokenID++;

         _safeMint(propertyOwner, tokenID);
         _setTokenURI(tokenID, metadataURI);

         propertyToToken[propertyID] = tokenID;
         tokenMinted[propertyID] = true;

         emit PropertyNFTMinted(
            propertyID,
            tokenID,
            propertyOwner
         );
    }

    function getTokenForProperty(uint256 propertyID)
    external
    view
    returns (uint256)
    {

        require(
            registry.isVerified(propertyID),
            "Property not verified"
        );
        require(
            tokenMinted[propertyID],
            "Property not minted"
        );

        return propertyToToken[propertyID];
    }

    function supportsInterface(bytes4 interfaceID)
        public
        view
        override(ERC721URIStorage, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceID);
    }
}