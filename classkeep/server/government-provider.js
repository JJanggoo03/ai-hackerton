import {createTeamCareerProvider} from './team-career-provider.js';

export function createGovernmentProviders(config){
 const team=createTeamCareerProvider(config);
 if(team)return {'government-employment':team};
 return {};
}
