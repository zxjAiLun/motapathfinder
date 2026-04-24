main.floors.M8=
{
    "floorId": "M8",
    "title": "心境 M8",
    "name": "心境 M8",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 10000000000000,
    "defaultGround": 1895,
    "bgm": "40.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "6,11": {
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
        "11,1": [
            {
                "type": "setValue",
                "name": "flag:door_M8_10_11",
                "operator": "+=",
                "value": "1"
            }
        ],
        "5,9": [
            {
                "type": "setValue",
                "name": "flag:door_M8_6_8",
                "operator": "+=",
                "value": "1"
            }
        ],
        "7,9": [
            {
                "type": "setValue",
                "name": "flag:door_M8_6_8",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "10,11": {
            "0": {
                "condition": "flag:door_M8_10_11==1",
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
                        "name": "flag:door_M8_10_11",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            },
            "1": null
        },
        "6,8": {
            "0": {
                "condition": "flag:door_M8_6_8==2",
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
                        "name": "flag:door_M8_6_8",
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
    [1886,1886,1886,1886,1886,1886,1886,1886,1886,1886,1886,1886,1886],
    [1886, 21,1968,  0,1886,  0, 87,  0,1886,  0,1019,1966,1886],
    [1886, 22,1967, 21, 81, 21, 21, 21, 81,1963,2070,1012,1886],
    [1886, 21,1968,  0,1886,  0,1973,  0,1886,  0,1019,  0,1886],
    [1886,1886, 83,1886,1886,1886, 82,1886,1886,1886, 83,1886,1886],
    [1886,643, 21,  0,1886,  0,2070, 82,1886, 21,1965, 22,1886],
    [1886,1012,2070,1971, 81,1012,1970,2070,1886,644,643,644,1886],
    [1886,644, 22,  0,1886, 82, 21,  0,1886,  0,1969,  0,1886],
    [1886,1886, 82,1886,1886,1886, 85,1886,1886,1886, 81,1886,1886],
    [1886,  0,1963,  0,1886,1966,  0,1966,1886,  0,1967,1012,1886],
    [1886,643,  0,1962, 81,  0,733,  0, 81,2070,1886,1886,1886],
    [1886, 92,644,  0,1886,  0, 88,  0,1886,1972, 85,1018,1886],
    [1886,1886,1886,1886,1886,1886,1886,1886,1886,1886,1886,1886,1886]
],
    "bgmap": [

],
    "fgmap": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 90,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0, 93,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0, 90,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "bg2map": [

],
    "fg2map": [

]
}