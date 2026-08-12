const REWARD_CLAIM_METHODS = Object.freeze({
  DIGITAL_STAMPS: 'digital_stamps',
  OFFLINE_LEAFLET: 'offline_leaflet'
});

function resolveRewardClaimMethod(stampCount, stampRequirement, offlineConfirmed) {
  if (offlineConfirmed === true) {
    return REWARD_CLAIM_METHODS.OFFLINE_LEAFLET;
  }

  if (
    Number.isInteger(stampCount) &&
    Number.isInteger(stampRequirement) &&
    stampCount >= stampRequirement
  ) {
    return REWARD_CLAIM_METHODS.DIGITAL_STAMPS;
  }

  return null;
}

module.exports = {
  REWARD_CLAIM_METHODS,
  resolveRewardClaimMethod
};
