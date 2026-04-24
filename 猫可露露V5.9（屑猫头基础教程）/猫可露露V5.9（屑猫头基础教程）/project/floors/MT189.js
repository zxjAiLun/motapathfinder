main.floors.MT189=
{
    "floorId": "MT189",
    "title": "189 层",
    "name": "189 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 10000,
    "defaultGround": 970,
    "bgm": "13.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "11,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "1,6": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "1,3": [
            {
                "type": "setValue",
                "name": "flag:door_MT189_2_2",
                "operator": "+=",
                "value": "1"
            }
        ],
        "3,3": [
            {
                "type": "setValue",
                "name": "flag:door_MT189_2_2",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "2,2": {
            "0": {
                "condition": "flag:door_MT189_2_2==2",
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
                        "name": "flag:door_MT189_2_2",
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
    [  4,  4,  4,156,156,156,156,156,156,156,156,156,156],
    [  4,  4,900, 83, 83, 83,577, 82,  0,576,156, 59,156],
    [  4,156, 85,156,156,156,472,156, 58,  0,156, 81,156],
    [156,489,  0,489,156,579,  0,478,  0,475, 81, 59,156],
    [156,  0,579,  0,156,156, 82,156,156, 81,156,156,156],
    [156,156,156, 82,156,576,  0, 21,156,576,  0,577,156],
    [156, 87,156,478,156,  0,585,  0,156,156,156,  0,156],
    [156,  0, 21,  0, 82,572,  0, 22, 82, 60,477,577,156],
    [156, 22,  0,156,156,156,482,156,156,156, 82,156,156],
    [156,485,156,572,156,579,  0, 60, 81,481,  0, 59,156],
    [156,586,477,  0,479,  0,156,  0,156,  0,156, 82,156],
    [156,576,156, 21,156,572,  0,586,156,481,  0, 88,156],
    [156,156,156,156,156,156,156,156,156,156,156,156,156]
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