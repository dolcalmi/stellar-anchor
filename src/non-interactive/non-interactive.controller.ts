import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { ConfigService, InjectConfig } from 'nestjs-config';
import { DepositDto } from './dto/deposit.dto';
import { DepositResponseDto } from './dto/deposit-response.dto';
import { AssetInterface } from '../interfaces/asset.interface';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { WithdrawDto } from './dto/withdraw.dto';
import { WithdrawalResponseDto } from './dto/withdrawal-response.dto';
import { MemoID } from 'stellar-sdk';
import { StellarService } from '../wallets/stellar.service';
import { AddressMappingService } from './address-mapping.service';
import { WalletFactoryService } from '../wallets/wallet-factory.service';
import { DepositMapping } from './deposit-mapping.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { AddressMapping } from './address-mapping.entity';

@Controller()
export class NonInteractiveController {
  constructor(
    @InjectConfig()
    private readonly config: ConfigService,
    private readonly stellarService: StellarService,
    @InjectRepository(AddressMapping)
    private readonly mappingRepo: Repository<AddressMapping>,
    @InjectRepository(DepositMapping)
    private readonly depositRepo: Repository<DepositMapping>,
    private readonly mappingService: AddressMappingService,
    private readonly walletFactoryService: WalletFactoryService,
  ) {
  }

  @Post(['deposit', 'transactions/deposit/non-interactive'])
  @UseInterceptors(AnyFilesInterceptor())
  async deposit(
    @Body() depositDto: DepositDto,
  ): Promise<DepositResponseDto> {
    const asset = this.config.get('assets').getAssetConfig(depositDto.asset_code);
    const { exists, trusts } = await this.stellarService.checkAccount(
      depositDto.account,
      asset.code,
      asset.stellar.issuer,
    );
    const mapping = await this.mappingService.getAddressMapping(
      this.walletFactoryService.get(asset.code),
      this.stellarService,
      {
        asset: asset.code,
        addressOut: depositDto.account,
        addressOutExtra: depositDto.memo,
        addressOutExtraType: depositDto.memo_type,
        email: depositDto.email_address,
      },
      this.depositRepo,
    );
    return {
      how: NonInteractiveController.getDepositAddressString(asset.code, mapping.addressIn, mapping.id.toString()),
      eta: asset.deposit.eta,
      min_amount: asset.deposit.min,
      max_amount: asset.deposit.max,
      fee_fixed: asset.deposit.fee_fixed + (exists ? 0 : asset.deposit.fee_create),
      fee_percent: asset.deposit.fee_percent,
      ...this.getExtraInfo(trusts, exists, asset),
    } as DepositResponseDto;
  }

  private static getDepositAddressString(asset: string, addressIn: string, addressInExtra: string) {
    switch (asset) {
      case 'KIN':
        return `memo: ${addressInExtra} address: ${addressIn}`;
      case 'XRP':
        return `tag: ${addressInExtra} address: ${addressIn}`;
      default:
        return addressIn;
    }
  }

  private getExtraInfo(trusts: boolean, exists: boolean, asset: AssetInterface) {
    return trusts && exists ? {} : {
      extra_info: {
        message: (exists ? `` : `Account will be funded with ${this.config.get('stellar').fundingAmount} XLM. `)
          + (trusts ? `` : `You need to establish a trustline for asset ${asset.code} to account ${asset.stellar.issuer}`),
      },
    };
  }

  @Post(['withdraw', 'transactions/withdraw/non-interactive'])
  @UseInterceptors(AnyFilesInterceptor())
  async withdraw(
      @Body() withdrawDto: WithdrawDto,
  ): Promise<WithdrawalResponseDto> {
    const asset = this.config.get('assets').getAssetConfig(withdrawDto.asset_code);
    const mapping = await this.mappingService.getAddressMapping(
      this.stellarService,
      this.walletFactoryService.get(withdrawDto.asset_code),
      {
        asset: withdrawDto.asset_code,
        addressOut: withdrawDto.dest,
        addressOutExtra: withdrawDto.dest_extra,
      },
      this.mappingRepo,
    );
    return {
      account_id: mapping.addressIn,
      memo_type: MemoID,
      memo: mapping.id.toString(),
      eta: asset.withdrawal.eta,
      min_amount: asset.withdrawal.min,
      max_amount: asset.withdrawal.max,
      fee_fixed: asset.withdrawal.fee_fixed,
      fee_percent: asset.withdrawal.fee_percent,
    } as WithdrawalResponseDto;
  }
}
