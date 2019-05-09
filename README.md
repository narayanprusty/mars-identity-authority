# mars-identity-authority

This is the REST APIs server for Identity Authority.

## ENVs

The following ENVs are required while starting the container:

1. `AWS_KEY`: IAM access key
2. `AWS_SECRET_KEY`: IAM secret key
3. `AWS_REGION`: Region where managed blockchain member is deployed
4. `CA_USERNAME`: CA username
5. `CA_PASSWORD`: CA password
6. `NETWORK_ID`: Managed blockchain member ID
7. `ORDERER_URL`: Orderer URL of the network
8. `CORE_PEER_ADDRESS`: Peer URL of the member
9. `CORE_PEER_TLS_ENABLED`: true
10. `CORE_PEER_TLS_ROOTCERT_FILE`: /home/managedblockchain-tls-chain.pem
11. `CORE_PEER_LOCALMSPID`: Managed blockchain member ID
12. `CORE_PEER_MSPCONFIGPATH`: /home/admin-msp

## Creating a Joint Channel

First ssh into the EC2 that's running the containers. Then gain access to shell of the containers using this command: `docker exec -i -t container_id /bin/bash`. Then create "identity" channel with all three authorities as members.

1. Run this command in working directory inside the docker container of identity authority to create MSP directory representing property authority: `mkdir property-authority-msp && mkdir property-authority-msp/admincerts && mkdir property-authority-msp/cacerts` 
2. Similarly create MSP directory for voting authority: `mkdir voting-authority-msp && mkdir voting-authority-msp/admincerts && mkdir voting-authority-msp/cacerts`
3. The copy the files from "admincerts" and "cacerts" directory of property authority and voting-authority containers
4. Replace content of configtx.yaml with this:

```yaml
Organizations:
    - &Org1
        Name: member-id
        ID: member-id
        MSPDir: /home/admin-msp
        AnchorPeers:
            - Host:
              Port:
    - &Org2
        Name: member-id
        ID: member-id
        MSPDir: /home/property-authority-msp
        AnchorPeers:
            - Host:
              Port:
    - &Org3
        Name: member-id
        ID: member-id
        MSPDir: /home/voting-authority-msp
        AnchorPeers:
            - Host:
              Port:
Application: &ApplicationDefaults
     Organizations:
Profiles:
    ThreeOrgChannel:
        Consortium: AWSSystemConsortium
        Application:
            <<: *ApplicationDefaults
            Organizations:
                - *Org1
                - *Org2
                - *Org3
```

> Add Member ID of the orgs for values Name and ID

4. Then run this command to generate the configtx peer block: `configtxgen -outputCreateChannelTx /home/identity.pb -profile ThreeOrgChannel -channelID identity --configPath /home/`
5. Now create the channel using this command: `peer channel create -c identity -f /home/identity.pb -o $ORDERER_URL  --cafile /home/managedblockchain-tls-chain.pem --tls`
6. Join IdentityAuthority to the channel by running this command: `peer channel join -b /home/identity.block -o $ORDERER_URL --cafile /home/managedblockchain-tls-chain.pem --tls`
7. Join property authority peer to the channel by running this command inside the property authority's docker container: `peer channel fetch 0 identity.block --tls -c identity -o $ORDERER_URL --cafile /home/managedblockchain-tls-chain.pem` and `peer channel join -b /home/identity.block -o $ORDERER_URL --cafile /home/managedblockchain-tls-chain.pem —tls`. Note that for these commands to work set the environment variables like step 5 inside this container.
8. Join voting authority peer to the channel by running this command inside the voting authority's docker container: `peer channel fetch 0 identity.block --tls -c identity -o $ORDERER_URL --cafile /home/managedblockchain-tls-chain.pem` and `peer channel join -b /home/identity.block -o $ORDERER_URL --cafile /home/managedblockchain-tls-chain.pem —tls`. Note that for these commands to work set the environment variables like step 5 inside this container.