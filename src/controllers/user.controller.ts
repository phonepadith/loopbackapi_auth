import {authenticate, TokenService, UserService} from '@loopback/authentication';
import {inject} from '@loopback/core';
import {model, property, repository} from '@loopback/repository';
import {get, getModelSchemaRef, HttpErrors, post, requestBody} from '@loopback/rest';
import {SecurityBindings, securityId, UserProfile} from '@loopback/security';
import _ from 'lodash';
import {PasswordHasherBindings, TokenServiceBindings, UserServiceBindings} from '../keys';
import {User} from '../models';
import {TransactionRepository, UserRepository} from '../repositories';
import {Credentials} from '../repositories/user.repository';
import {PasswordHasher} from '../services/hash.password.bcryptjs';
import {validateCredentials} from '../services/validator';
import {OPERATION_SECURITY_SPEC} from '../utils/security-spec';
import {CredentialsRequestBody} from './specs/user-controller.specs';


@model()
export class NewUserRequest extends User {
  @property({
    type: 'string',
    required: true,
  })
  password: string;
}


export class UserController {
  constructor(
    @repository(UserRepository)
    public userRepository: UserRepository,
    @repository(TransactionRepository)
    public transactionRepository: TransactionRepository,
    @inject(PasswordHasherBindings.PASSWORD_HASHER)
    public passwordHasher: PasswordHasher,
    @inject(TokenServiceBindings.TOKEN_SERVICE)
    public jwtService: TokenService,
    @inject(UserServiceBindings.USER_SERVICE)
    public userService: UserService<User, Credentials>,
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

  async getbalance(publicKey: any) {
    const fetch = require('node-fetch');
    try {
      const response = await fetch(
        `https://horizon-testnet.stellar.org/accounts/${encodeURIComponent(publicKey)}`
      );
      const responseJSON = await response.json();
      const balance = responseJSON.balances[0].balance;
      //console.log("Get Account SUCCESS!:)\n", balance);
      return balance;
    } catch (e) {
      console.error("ERROR!", e);
    }

  }

  @post('/users', {
    responses: {
      '200': {
        description: 'User model instance',
        content: {'application/json': {schema: getModelSchemaRef(User)}},
      },
    },
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(User, {
            title: 'NewUser',
            exclude: ['id', 'privatekey', 'publickey', 'roles'],
          }),
        },
      },
    })
    user: Omit<User, 'id'>,
  ) {
    //Stellar keygenerate
    var StellarSdk = require('stellar-sdk');
    const fetch = require('node-fetch');
    const pair = StellarSdk.Keypair.random();

    var privatekey = pair.secret();
    var publickey = pair.publicKey();

    user.privatekey = privatekey;
    user.publickey = publickey;
    user.roles = 'user';
    validateCredentials(_.pick(user, ['email', 'password']));

    //Check User
    const checkuser = await this.checkUser(user.email);

    // encrypt the password
    user.password = await this.passwordHasher.hashPassword(
      user.password
    );



    if (checkuser == 1) {
      try {
        const response = await fetch(
          `https://friendbot.stellar.org?addr=${encodeURIComponent(user.publickey)}`
        );
        const responseJSON = await response.json();
        console.log("SUCCESS! You have a new account :)\n", responseJSON);
        return await this.userRepository.create(user);
      } catch (e) {
        console.error("ERROR!", e);

      }
    } else {
      throw new HttpErrors[401]("This user is already registered");

    }


  }

  @post('/users/login', {
    responses: {
      '200': {
        description: 'Token',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                token: {
                  type: 'string',
                },
              },
            },
          },
        },
      },
    },
  })
  async login(
    @requestBody(CredentialsRequestBody) credentials: Credentials,
  ): Promise<{token: string}> {
    // ensure the user exists, and the password is correct
    const user = await this.userService.verifyCredentials(credentials);

    // convert a User object into a UserProfile object (reduced set of properties)
    const userProfile = this.userService.convertToUserProfile(user);

    // create a JSON Web Token based on the user profile
    const token = await this.jwtService.generateToken(userProfile);

    return {token};
  }

  @get('/user/me', {
    security: OPERATION_SECURITY_SPEC,
    responses: {
      '200': {
        description: 'The current user profile',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                user: {
                  type: 'string',
                },
                balance: {
                  type: 'string',
                },
              },
            },
          },
        },
      },
    },
  })
  @authenticate('jwt')
  async printCurrentUser(
    @inject(SecurityBindings.USER)
    currentUserProfile: UserProfile,
  ) //: Promise<User>
  {

    // (@jannyHou)FIXME: explore a way to generate OpenAPI schema
    // for symbol property
    var round = require('math-round');

    currentUserProfile.id = currentUserProfile[securityId];
    var getUser = await this.userRepository.findOne({
      where: {email: currentUserProfile.id},
    });

    var valbalance = await this.getbalance(getUser?.publickey)
    var roundbalance = round(valbalance);
    //delete currentUserProfile[securityId];
    return {
      user: currentUserProfile.id,
      balance: roundbalance
    };
  }

  @get('/user/history', {
    security: OPERATION_SECURITY_SPEC,
    responses: {
      '200': {
        description: 'The current user profile',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                history: {
                  type: 'object',
                },
              },
            },
          },
        },
      },
    },
  })
  @authenticate('jwt')
  async printHistory(
    @inject(SecurityBindings.USER)
    currentUserProfile: UserProfile,
  ) //: Promise<User>
  {

    currentUserProfile.id = currentUserProfile[securityId];
    const transactiondetial = await this.transactionRepository.find({
      where: {or: [{source: currentUserProfile.id}, {destination: currentUserProfile.id}]},
    });

    return {history: transactiondetial}
  }

}



