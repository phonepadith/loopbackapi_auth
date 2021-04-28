import {authenticate} from '@loopback/authentication';
import {inject} from '@loopback/core';
import {repository} from '@loopback/repository';
import {getModelSchemaRef, HttpErrors, post, requestBody} from '@loopback/rest';
import {SecurityBindings, securityId, UserProfile} from '@loopback/security';
import {Transaction} from '../models';
import {TransactionRepository, UserRepository} from '../repositories';
import {OPERATION_SECURITY_SPEC} from '../utils/security-spec';


export class TransactionController {
  constructor(
    @repository(TransactionRepository)
    public transactionRepository: TransactionRepository,
    @repository(UserRepository)
    public userRepository: UserRepository,
  ) {}

  async checkUser(useremail: any) {
    const foundUser = await this.userRepository.findOne({
      where: {email: useremail},
    });

    if (foundUser) {
      return 0;
    }
    return 1;
  }


  async transactionbuild(sourcepublickey: any, sourceprivatekey: any, destinationpublickey: any, sourceamount: any) {
    // Transactions require a valid sequence number that is specific to this account.
    // We can fetch the current sequence number for the source account from Horizon.

    const StellarSdk = require('stellar-sdk');
    const server = new StellarSdk.Server('https://horizon-testnet.stellar.org');
    const account = await server.loadAccount(sourcepublickey);

    const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceprivatekey);
    const sourcePublicKey = sourceKeypair.publicKey();


    // Right now, there's one function that fetches the base fee.
    // In the future, we'll have functions that are smarter about suggesting fees,
    // e.g.: `fetchCheapFee`, `fetchAverageFee`, `fetchPriorityFee`, etc.
    const fee = await server.fetchBaseFee();


    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee,
      // Uncomment the following line to build transactions for the live network. Be
      // sure to also change the horizon hostname.
      // networkPassphrase: StellarSdk.Networks.PUBLIC,
      networkPassphrase: StellarSdk.Networks.TESTNET
    })
      // Add a payment operation to the transaction
      .addOperation(StellarSdk.Operation.payment({
        destination: destinationpublickey,
        // The term native asset refers to lumens
        asset: StellarSdk.Asset.native(),
        // Specify 350.1234567 lumens. Lumens are divisible to seven digits past
        // the decimal. They are represented in JS Stellar SDK in string format
        // to avoid errors from the use of the JavaScript Number data structure.
        amount: sourceamount,
      }))
      // Make this transaction valid for the next 30 seconds only
      .setTimeout(30)
      // Uncomment to add a memo (https://www.stellar.org/developers/guides/concepts/transactions.html)
      // .addMemo(StellarSdk.Memo.text('Hello world!'))
      .build();

    // Sign this transaction with the secret key
    // NOTE: signing is transaction is network specific. Test network transactions
    // won't work in the public network. To switch networks, use the Network object
    // as explained above (look for StellarSdk.Network).
    transaction.sign(sourceKeypair);

    // Let's see the XDR (encoded in base64) of the transaction we just built
    console.log(transaction.toEnvelope().toXDR('base64'));

    // Submit the transaction to the Horizon server. The Horizon server will then
    // submit the transaction into the network for us.
    try {
      const transactionResult = await server.submitTransaction(transaction);
      console.log(JSON.stringify(transactionResult, null, 2));
      console.log('\nSuccess! View the transaction at: ');
      console.log(transactionResult._links.transaction.href);
    } catch (e) {
      console.log('An error has occured:');
      console.log(e);
    }
  }

  @post('/transactions', {
    security: OPERATION_SECURITY_SPEC,
    responses: {
      '200': {
        description: 'Transaction model instance',
        content: {
          'application/json': {
            schema: getModelSchemaRef(Transaction)
          }
        },
      },
    },
  })
  @authenticate('jwt')
  async create(
    @inject(SecurityBindings.USER)
    currentUserProfile: UserProfile,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Transaction, {
            title: 'NewTransaction',
            exclude: ['id', 'source', 'date'],
          }),
        },
      },
    })
    transaction: Omit<Transaction, 'id'>,
  ) {
    const date = require('date-and-time');
    const now = new Date();

    transaction.date = date.format(now, 'HH:mm:ss ddd, MMM DD YYYY');


    currentUserProfile.id = currentUserProfile[securityId];
    var checkdestination = await this.checkUser(transaction.destination);
    //var source = currentUserProfile.id

    if (checkdestination == 1) {
      throw new HttpErrors[401]("An error has occured: No Destination in database");
    }

    const sourcdetail = await this.userRepository.findOne({
      where: {email: currentUserProfile.id},
    });

    const destinationdetail = await this.userRepository.findOne({
      where: {email: transaction.destination},
    });

    const spublickey = sourcdetail?.publickey;
    const sprivatekey = sourcdetail?.privatekey;
    const dpublickey = destinationdetail?.publickey;

    transaction.source = currentUserProfile.id;



    if (transaction.source == transaction.destination) {
      throw new HttpErrors[401]("An error has occured: Sender is same as Destination");
    }

    if (transaction.source == currentUserProfile.id && transaction.source != transaction.destination) {
      try {
        await this.transactionbuild(spublickey, sprivatekey, dpublickey, transaction.amount);
        console.log('Transaction Success !!');
        return this.transactionRepository.create(transaction);
      } catch (e) {
        console.log('An error has occured:');
        console.log(e);
      }
    } else {
      throw new HttpErrors[401]("An error has occured: User is missing");
    }


  }


}
