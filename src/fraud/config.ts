export interface Thresholds {
  /** How far back account history is loaded for rule evaluation. */
  historyWindowHours: number;

  amountSpikeMultiplier: number;
  amountSpikeMinAbs: number;
  amountSpikeWeight: number;

  velocityWindowMin: number;
  velocityMaxCount: number;
  velocityWeight: number;

  geoMismatchWeight: number;

  newAccountMaxAmount: number;
  newAccountHighAmountWeight: number;

  /** score >= reviewScore → REVIEW */
  reviewScore: number;
  /** score >= declineScore → DECLINE */
  declineScore: number;
}

export const THRESHOLDS: Thresholds = {
  historyWindowHours: 24,

  amountSpikeMultiplier: 5,
  amountSpikeMinAbs: 500,
  amountSpikeWeight: 40,

  velocityWindowMin: 10,
  velocityMaxCount: 5,
  velocityWeight: 35,

  geoMismatchWeight: 30,

  newAccountMaxAmount: 5000,
  newAccountHighAmountWeight: 40,

  reviewScore: 30,
  declineScore: 70
};
