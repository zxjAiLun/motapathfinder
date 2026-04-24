main.floors.MT764=
{
    "floorId": "MT764",
    "title": "764 层",
    "name": "764 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 10000000000000,
    "defaultGround": 1891,
    "bgm": "40.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "6,1": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "11,11": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "1,5": [
            {
                "type": "setValue",
                "name": "flag:door_MT764_2_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "3,5": [
            {
                "type": "setValue",
                "name": "flag:door_MT764_2_4",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "2,4": {
            "0": {
                "condition": "flag:door_MT764_2_4==2",
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
                        "name": "flag:door_MT764_2_4",
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
    [  4,  4,  4,  4,  4,1882,1882,1882,1882,1882,1882,1882,1882],
    [  4,1014,  0,644,  4,  0, 88, 16,  0,1882,1012, 23,1882],
    [  4,  0,1763,  0, 83,1961,  0,1882,1967,1882,  0,643,1882],
    [  4,644,  0,1014,  4, 81,1882,1882,644, 16,1960,  0,1882],
    [  4,  4, 85,  4,  4,  0,1968,1882,1882,1882,1882,1963,1882],
    [1882,1970,  0,1970,1882,1967,643, 15,1963,  0,1882,1019,1882],
    [1882,  0,646,  0,1882,1882,1882,1882,  0,2070,1882, 16,1882],
    [1882,1012,2070,1012,1968, 21,2070, 15,1969,2070,1882,2070,1882],
    [1882,1882, 15,1882,1882,1882,1882,1882,1882,1882,1882,1964,1882],
    [1882,  0,1964,  0,1963, 15, 21,1962, 21,  0,1968,1014,1882],
    [1882, 22,1438,1438,1438,1882,  0,1882,1882, 81,1882,  0,1882],
    [1882, 22, 22, 22, 22,1882,1013,1882,1012,1964,1882, 87,1882],
    [1882,1882,1882,1882,1882,1882,1882,1882,1882,1882,1882,1882,1882]
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