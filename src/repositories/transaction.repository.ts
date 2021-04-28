import {DefaultCrudRepository} from '@loopback/repository';
import {Transaction, TransactionRelations} from '../models';
import {DbstellarDataSource} from '../datasources';
import {inject} from '@loopback/core';

export class TransactionRepository extends DefaultCrudRepository<
  Transaction,
  typeof Transaction.prototype.id,
  TransactionRelations
> {
  constructor(
    @inject('datasources.dbstellar') dataSource: DbstellarDataSource,
  ) {
    super(Transaction, dataSource);
  }
}
