import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	MINIMUM_AVAILABILITIES,
	planPresetRepair,
	presetInputNeedsLiveOptions,
	presetIsUsable,
	validatePresetInput
} from './preset-input.ts';

const options = {
	qualityProfiles: [{ id: 1 }, { id: 2 }],
	rootFolders: [{ path: '/movies' }],
	tags: [{ id: 4 }]
};

test('AUD-06: a preset must reference a quality profile that exists on the instance', () => {
	const valid = validatePresetInput({ name: 'Good', qualityProfileId: 2, rootFolderPath: '/movies' }, 'radarr', options);
	assert.equal(valid, null);

	const stale = validatePresetInput({ qualityProfileId: 999 }, 'radarr', options);
	assert.match(String(stale), /qualityProfileId does not exist/);
});

test('AUD-06: a preset must reference a root folder that exists on the instance', () => {
	const stale = validatePresetInput({ rootFolderPath: '/gone' }, 'radarr', options);
	assert.match(String(stale), /rootFolderPath does not exist/);
});

test('AUD-06: a preset must reference tag ids that exist on the instance', () => {
	assert.equal(validatePresetInput({ tags: [4] }, 'radarr', options), null);
	const stale = validatePresetInput({ tags: [4, 77] }, 'radarr', options);
	assert.match(String(stale), /tag id 77 does not exist/);
});

test('AUD-06: minimum availability is restricted to the arr enum for Radarr', () => {
	for (const value of MINIMUM_AVAILABILITIES) {
		assert.equal(validatePresetInput({ minimumAvailability: value }, 'radarr'), null, value);
	}
	assert.match(String(validatePresetInput({ minimumAvailability: 'bogus' }, 'radarr')), /minimumAvailability must be one of/);
	// Sonarr has no minimum-availability concept; a value there is inert, not a save error.
	assert.equal(validatePresetInput({ minimumAvailability: 'bogus' }, 'sonarr'), null);
});

test('preset shape validation is unchanged for the fields the UI edits', () => {
	assert.equal(validatePresetInput({}, 'radarr'), null);
	assert.equal(validatePresetInput({ name: '   ' }, 'radarr'), 'name is required');
	assert.equal(validatePresetInput({ qualityProfileId: 0 }, 'radarr'), 'qualityProfileId must be a positive integer');
	assert.equal(validatePresetInput({ rootFolderPath: '' }, 'radarr'), 'rootFolderPath must be a non-empty string');
	assert.equal(validatePresetInput({ tags: [0] }, 'radarr'), 'tags must be an array of positive tag ids');
	assert.equal(validatePresetInput({ monitored: 'yes' as unknown as boolean }, 'radarr'), 'monitored must be a boolean');
	assert.equal(
		validatePresetInput({ seriesTypeDefault: 'cartoon' }, 'sonarr'),
		'seriesTypeDefault must be one of standard, daily, anime'
	);
	assert.equal(
		validatePresetInput({ seasonMonitorPolicy: 'some' }, 'sonarr'),
		'seasonMonitorPolicy must be one of all, none, first, latest'
	);
});

test('presetInputNeedsLiveOptions only trips on arr-side targeting fields', () => {
	assert.equal(presetInputNeedsLiveOptions({ isDefault: true }), false);
	assert.equal(presetInputNeedsLiveOptions({ monitored: false }), false);
	assert.equal(presetInputNeedsLiveOptions({ qualityProfileId: 1 }), true);
	assert.equal(presetInputNeedsLiveOptions({ rootFolderPath: '/movies' }), true);
	assert.equal(presetInputNeedsLiveOptions({ tags: [] }), false, 'empty tags need no live lookup (AUD-06 follow-up)');
	assert.equal(presetInputNeedsLiveOptions({ tags: [4] }), true);
});

test('AUD-07: preset usability requires a live profile id and root folder', () => {
	const profiles = [{ id: 1 }, { id: 2 }];
	const folders = [{ path: '/movies' }];

	assert.equal(presetIsUsable({ quality_profile_id: 1, root_folder_path: '/movies' }, profiles, folders), true);
	assert.equal(
		presetIsUsable({ quality_profile_id: 999, root_folder_path: '/movies' }, profiles, folders),
		false,
		'deleted quality profile must be repaired on reconnect'
	);
	assert.equal(
		presetIsUsable({ quality_profile_id: 1, root_folder_path: '/removed' }, profiles, folders),
		false,
		'removed root folder must be repaired on reconnect'
	);
	assert.equal(presetIsUsable({ quality_profile_id: 0, root_folder_path: '/movies' }, profiles, folders), false);
	assert.equal(presetIsUsable({ quality_profile_id: 1, root_folder_path: '' }, profiles, folders), false);
	assert.equal(presetIsUsable(null, profiles, folders), false);
	assert.equal(presetIsUsable(undefined, profiles, folders), false);
});

test('AUD-07 follow-up: repair plan only replaces the stale targeting field', () => {
	const profiles = [{ id: 1 }, { id: 2 }];
	const folders = [{ path: '/movies' }, { path: '/tv' }];

	assert.equal(
		planPresetRepair({ quality_profile_id: 2, root_folder_path: '/tv' }, profiles, folders),
		null,
		'fully valid preset needs no repair'
	);
	assert.deepEqual(
		planPresetRepair({ quality_profile_id: 999, root_folder_path: '/tv' }, profiles, folders),
		{ qualityProfileId: 1, rootFolderPath: '/tv' },
		'a stale profile must not reset a still-valid root folder'
	);
	assert.deepEqual(
		planPresetRepair({ quality_profile_id: 2, root_folder_path: '/gone' }, profiles, folders),
		{ qualityProfileId: 2, rootFolderPath: '/movies' },
		'a stale root folder must not reset a still-valid profile'
	);
	assert.deepEqual(
		planPresetRepair({ quality_profile_id: 0, root_folder_path: '' }, profiles, folders),
		{ qualityProfileId: 1, rootFolderPath: '/movies' }
	);
	assert.equal(planPresetRepair(null, profiles, folders), null);
});
