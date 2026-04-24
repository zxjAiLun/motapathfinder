main.floors.MT773=
{
    "floorId": "MT773",
    "title": "773 层",
    "name": "773 层",
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
        "11,1": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "1,1": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "9,5": [
            {
                "type": "setValue",
                "name": "flag:door_MT773_10_8",
                "operator": "+=",
                "value": "1"
            }
        ],
        "9,7": [
            {
                "type": "setValue",
                "name": "flag:door_MT773_10_8",
                "operator": "+=",
                "value": "1"
            }
        ],
        "11,5": [
            {
                "type": "setValue",
                "name": "flag:door_MT773_10_8",
                "operator": "+=",
                "value": "1"
            }
        ],
        "11,7": [
            {
                "type": "setValue",
                "name": "flag:door_MT773_10_8",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "10,8": {
            "0": {
                "condition": "flag:door_MT773_10_8==4",
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
                        "name": "flag:door_MT773_10_8",
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
    [1884, 87,  0, 16,1971,  0,1968, 81,1975, 21,  0, 88,1884],
    [1884,  0,  0,1884,  0,1012,  0,1884, 81,1884,1884,1884,1884],
    [1884, 15,1884,1884,644,1438, 21,1884,643,  0,1967, 50,1884],
    [1884,1975,  0,1884,1884, 81,1884,1884,1884, 82, 82,1884,1884],
    [1884,  0,1012,1884,643,  0,1971,2070,1884,1977,  0,1977,1884],
    [1884,643, 21,1884,1976,1884,1884, 81,1884,  0, 23,  0,1884],
    [1884,  0,1975, 81, 21,  0,1972,2070,1884,1972,  0,1972,1884],
    [1884, 81,1884,1884,1884,1884,1884,1884,  4,  4, 85,  4,  4],
    [1884,644,  0,1976,1884,  0,1974, 22,  4,1012,646, 47,  4],
    [1884,1970,1884,  0,1884, 21,1884,1975, 83,1019,1764,1013,  4],
    [1884, 15,1974,644, 82,  0, 81,1014,  4, 47,1014,1012,  4],
    [1884,1884,1884,1884,1884,1884,1884,1884,  4,  4,  4,  4,  4]
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