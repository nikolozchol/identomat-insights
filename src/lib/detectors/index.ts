import { DetectorResult } from './util';
import { detectQueryOnPage2 } from './queryOnPage2';
import { detectQueryHighImprNoClick } from './queryHighImprNoClick';
import { detectQueryPositionDecline } from './queryPositionDecline';
import { detectQueryReachedPage1 } from './queryReachedPage1';
import { detectPageClicksLost } from './pageClicksLost';
import { detectPageClicksGained } from './pageClicksGained';
import { detectTrafficDropByPage } from './trafficDropByPage';
import { detectTrafficSpike } from './trafficSpike';
import { detectTrafficNoConversion } from './trafficNoConversion';
import { detectDemoRequestDrop } from './demoRequestDrop';
import { detectSourceDecline } from './sourceDecline';
import { detectChannelMixShift } from './channelMixShift';
import { detectBestConvertingChannel } from './bestConvertingChannel';
import { detectHighRageClicks } from './highRageClicks';
import { detectDeadClicksOnStatic } from './deadClicksOnStatic';
import { detectQuickBack } from './quickBack';
import { detectJsErrors } from './jsErrors';
import { detectCtaNotReached } from './ctaNotReached';
import { detectCountryShift } from './countryShift';
import { detectReferralSpike } from './referralSpike';
import { detectStaleTrafficPage } from './staleTrafficPage';
import { detectOrphanHighIntent } from './orphanHighIntent';

export type Detector = {
  name: string;
  run: (opts: { workspaceId: string }) => Promise<DetectorResult>;
};

export const detectors: Detector[] = [
  { name: 'query_on_page_2', run: detectQueryOnPage2 },
  { name: 'query_high_impressions_no_click', run: detectQueryHighImprNoClick },
  { name: 'query_position_decline', run: detectQueryPositionDecline },
  { name: 'query_reached_page_1', run: detectQueryReachedPage1 },
  { name: 'page_clicks_lost', run: detectPageClicksLost },
  { name: 'page_clicks_gained', run: detectPageClicksGained },
  { name: 'traffic_drop_by_page', run: detectTrafficDropByPage },
  { name: 'traffic_spike', run: detectTrafficSpike },
  { name: 'traffic_no_conversion', run: detectTrafficNoConversion },
  { name: 'demo_request_drop', run: detectDemoRequestDrop },
  { name: 'source_decline', run: detectSourceDecline },
  { name: 'channel_mix_shift', run: detectChannelMixShift },
  { name: 'best_converting_channel', run: detectBestConvertingChannel },
  { name: 'high_rage_clicks', run: detectHighRageClicks },
  { name: 'dead_clicks_on_static', run: detectDeadClicksOnStatic },
  { name: 'quick_back', run: detectQuickBack },
  { name: 'js_errors', run: detectJsErrors },
  { name: 'cta_not_reached', run: detectCtaNotReached },
  { name: 'country_shift', run: detectCountryShift },
  { name: 'referral_spike', run: detectReferralSpike },
  { name: 'stale_traffic_page', run: detectStaleTrafficPage },
  { name: 'orphan_high_intent', run: detectOrphanHighIntent },
];
