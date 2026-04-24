main.floors.MT774=
{
    "floorId": "MT774",
    "title": "774 层",
    "name": "774 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 10000000000000,
    "defaultGround": 1893,
    "bgm": "40.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "1,1": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "6,1": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "1,10": [
            {
                "type": "setValue",
                "name": "flag:door_MT774_2_9",
                "operator": "+=",
                "value": "1"
            }
        ],
        "3,10": [
            {
                "type": "setValue",
                "name": "flag:door_MT774_2_9",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "2,9": {
            "0": {
                "condition": "flag:door_MT774_2_9==2",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT774_2_9",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        }
    },
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [1884,1884,1884,1884,1884,1884,1884,1884,1884,1884,1884,1884,1884],
    [1884, 88,  0, 83,1975,  0, 87,  0,1975, 81,  0,1015,1884],
    [1884,  0,733,1884,  0, 21, 21, 21,  0,1884,1015,  0,1884],
    [1884,1977,1884,1884,1884,1884,1884, 81,1884,1884,1884, 81,1884],
    [1884,2070,  0,1974,1974,1438,1884, 22,1884, 21,1884,644,1884],
    [1884,1884,1979,1884,1884, 15,1884,1972,1884, 21,1884,  0,1884],
    [1884,1014,  0,1013, 15, 16,1884,2070,1884, 21,1884,1977,1884],
    [1884,  0,2072,  0,1884,1884,1884,1971,1884,  0,1976,  0,1884],
    [1884,643,  0,644,1884,644,1486,  0,1884,1884,1884, 15,1884],
    [1884,1884, 85,1884,1884,1884,1884,1884,1884,  0,2070,1972,1884],
    [1884,1976,  0,1976,1884,  0,643,  0,1884, 21,1976,2070,1884],
    [1884,  0,646,  0, 81,1973,736,1973, 15,1977,732,  0,1884],
    [1884,1884,1884,1884,1884,1884,1884,1884,1884,1884,1884,1884,1884]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

]
}